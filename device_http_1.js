'use strict';

var colors = require('colors');
var parseString = require('xml2js').parseString;


//-------------------------------------------------------Connection 설정-------------------------------------------------------//
var config = require('./config_1');
var httpReq = require('./promise-http').request;
var httpRes = require('http');

console.log(colors.green('### ThingPlug - LoRa virtual Device###'));
if(typeof config == 'undefined') {
  console.log(colors.red('먼저 config.js를 열어 config를 설정하세요. README.md에 Starterkit 실행 방법이 설명되어 있습니다.'));
  return;
}
//=============================================================================================================================//


//-------------------------------------------------------Virtual Sensor Data---------------------------------------------------//
var IntervalFunction;
var UPDATE_CONTENT_INTERVAL = 1000;
var BASE_TEMP = 30;
var BASE_HUMID = 60;
var BASE_WIND = 10;
//=============================================================================================================================//

//--------------------------------------------Request ID를 생성하기 위한 RandomInt Function------------------------------------//
function randomInt (low, high) {
	return Math.floor(Math.random() * (high - low + 1) + low);
}
//=============================================================================================================================//


//----------------------------------------------mgmtCmd를 받기 위한 HTTP Server------------------------------------------------//
httpRes.createServer(function (req, res) {

    console.log(colors.green('mgmtCmd 제어 요청'));
	req.on('data', function (chunk) {
		parseString( chunk, function(err, xmlObj){
			if(!err){

				try{
					console.log('RI : '+xmlObj['m2m:exin']['ri'][0]);		//Resource ID 출력, (ex : EI000000000000000)
					console.log('CMT : '+xmlObj['m2m:exin']['cmt'][0]);		//Type
					console.log('EXRA : '+xmlObj['m2m:exin']['exra'][0]);	//CMD 출력

					var req = JSON.parse(xmlObj['m2m:exin']['exra'][0]);
					var cmt = xmlObj['m2m:exin']['cmt'][0];
					processCMD(req, cmt);
					var ei = xmlObj['m2m:exin']['ri'][0];
					updateExecInstance(ei, cmt);						//동작 수행 완료 보고
				}
				catch(e){
					console.error(chunk);
					console.error(e);
				}

			}
		});
	});

  res.setHeader("Content-Type", "application/vnd.onem2m-res+xml");
  res.writeHead(200);
  res.end('');
}).listen(config.responsePORT);


function processCMD(req, cmt){
	if(cmt=='RepImmediate'){						//즉시보고
		BASE_TEMP = 10;
	}
	else if(cmt=='RepPerChange'){					//주기변경
		UPDATE_CONTENT_INTERVAL = req.cmd*1000;
		console.log('UPDATE_CONTENT_INTERVAL: ' + UPDATE_CONTENT_INTERVAL);
		clearInterval(IntervalFunction);
		IntervalFunction = setInterval(IntervalProcess, UPDATE_CONTENT_INTERVAL);
	}
	else if(cmt=='DevReset'){						//디바이스 리셋
		BASE_TEMP = 30;
	}
	else{
		console.log('Unknown CMD');
	}
}
//=============================================================================================================================//


//------------------------------------------------ 1. node 생성 요청-----------------------------------------------------------//
httpReq({
  options: {
	  host: config.TPhost,
      port: config.TPport,
      path : '/'+config.AppEUI+'/'+config.version,
    method: 'POST',
    headers : {
      'X-M2M-Origin': config.nodeID,								//해당 요청 메시지 송신자의 식별자
      'X-M2M-RI': config.nodeID+'_'+randomInt(100000, 999999),		//해당 요청 메시지에 대한 고유 식별자 (RI == Request ID) / 해당 식별자는 CSE가 자동 생성
      'X-M2M-NM': config.nodeID,           							//해당 요청으로 생성하게 되는 자원의 이름 (NM == Name)
      'Accept': 'application/json',									//Response 받을 형태를 JSON으로 설정
      'Content-Type': 'application/json;ty=14', 					//JSON형태의 데이터 전송, ty는 생성하고자 하는 Resource Type의 식별자 (ty == 14은 node를 의미함)
    }
  },
  body : {nod :
  {ni : config.nodeID,												//등록하는 CSE의 LTID 사용
   mga : 'HTTP|' + config.responseAddress							//등록하는 CSE의 물리적 접근 식별자 또는 주소
  }}

//=============================================================================================================================//

//-------------------------------------------------------1. node 생성 Response-------------------------------------------------//
}).then(function(result){
  console.log(colors.green('1. node 생성 결과'));
  if(result.statusCode == 409){
    console.log('이미 생성된 node resource ID 입니다.');
  }
  config.nodeRI = JSON.parse(result.data).nod.ri;	//NODE의 Resource ID
  console.log(colors.yellow('생성 node Resource ID : ') + config.nodeRI);
//=============================================================================================================================//

//-------------------------------------------------2. remoteCSE생성 요청(기기등록)---------------------------------------------//
  return httpReq({
    options: {
	  host: config.TPhost,
      port: config.TPport,
      path : '/'+config.AppEUI+'/'+config.version,
      method: 'POST',
      headers : {
        'X-M2M-Origin': config.nodeID,									//해당 요청 메시지 송신자의 식별자
        'X-M2M-RI': config.nodeID+'_'+randomInt(100000, 999999),		//해당 요청 메시지에 대한 고유 식별자 (RI == Request ID) / 해당 식별자는 CSE가 자동 생성
        'X-M2M-NM': config.nodeID,										//해당 요청으로 생성하게 되는 자원의 이름 (NM == Name)
        'passCode': config.passCode,
        'Accept': 'application/json',									//Response 받을 형태를 JSON으로 설정
        'Content-Type': 'application/json;ty=16'						//JSON형태의 데이터 전송, ty는 생성하고자 하는 Resource Type의 식별자 (ty == 16은 remoteCSE를 의미함)
      }
    },
    body : {csr : {
    cst : 3, 										//등록하는 CSE의 타입 (IN-CSE = 1, MN-CSE = 2, ASN-CSE = 3) (cseType == cst)
    csi : config.nodeID, 							//등록하는 CSE의 식별자 (CSE-ID == csi)
    rr : true, 										//HTTP 프로토콜인데, 수신 받는 객체의 IP가 고정 아이피 IP인 경우에도 ‘True’로 설정하고, 나머지 경우는 ‘False’로 표현
    nl : config.nodeRI								//논리적 정보를 포함하는 실제 물리적 LoRa 디바이스 Resource인 <node> Resource의 Resource 식별자
  }}
  });
//=============================================================================================================================//

//----------------------------------------2. remoteCSE생성 요청(기기등록) Response---------------------------------------------//
}).then(function(result){
  console.log(colors.green('2. remoteCSE 생성 결과'));
  if(result.statusCode == 409){
    console.log('이미 생성된 remoteCSE 입니다.');
  }
  if(result.headers.dkey){
    console.log('다비이스 키 : '+ result.headers.dkey);							//remoteCSE 생성후 밝급되는 dKey
    console.log('content-location: '+ result.headers['content-location']);		//생성된 자원의 URI
    config.dKey= result.headers.dkey;
  }
//=============================================================================================================================//
}).then(function(result){

//---------------------------------------------------3. container 생성 요청----------------------------------------------------//
  return httpReq({
    options: {
	  host: config.TPhost,
      port: config.TPport,
      path : '/'+config.AppEUI+'/'+config.version+'/remoteCSE-'+ config.nodeID,
      method: 'POST',
      headers : {
        'X-M2M-Origin': config.nodeID,									//해당 요청 메시지 송신자의 식별자
        'X-M2M-RI': config.nodeID+'_'+randomInt(100000, 999999),		//해당 요청 메시지에 대한 고유 식별자 (RI == Request ID) / 해당 식별자는 CSE가 자동 생성
        'X-M2M-NM': config.containerName,								//해당 요청으로 생성하게 되는 자원의 이름 (NM == Name)
        'dkey' : config.dKey,											//container 생성을 위한 device Key (remoteCSE를 생성할때 발급)
        'Accept': 'application/json',									//Response 받을 형태를 JSON으로 설정
        'Content-Type': 'application/json;ty=3'							//JSON형태의 데이터 전송, ty == 3은 생성하고자 하는 container 자원을 의미함
      }
    },
    body : {cnt:{
    containerType : 'heartbeat',
    heartbeatPeriod : 300
  }}
  });
//=============================================================================================================================//

//--------------------------------------------3. container 생성 요청 Response--------------------------------------------------//
}).then(function(result){
  console.log(colors.green('3. container 생성 결과'));
  if(result.statusCode == 409){
    console.log('이미 생성된 container 입니다.');
  }
  console.log('content-location: '+ result.headers['content-location']);		//생성된 자원의 URI
//=============================================================================================================================//

//---------------------------4. 장치 제어를 위한 device mgmtCmd DevReset 리소스 생성 요청--------------------------------------//
  return httpReq({
    options: {
	  host: config.TPhost,
      port: config.TPport,
      path : '/'+config.AppEUI+'/'+config.version,
      method: 'POST',
      headers : {
        'Accept': 'application/json',										//Response 받을 형태를 JSON으로 설정
        dkey : config.dKey,													//mgmtCmd 생성을 위한 device Key (remoteCSE를 생성할때 발급)
        'X-M2M-Origin': config.nodeID,										//해당 요청 메시지 송신자의 식별자
        'X-M2M-RI': config.nodeID+'_'+randomInt(100000, 999999),			//해당 요청 메시지에 대한 고유 식별자 (RI == Request ID) / 해당 식별자는 CSE가 자동 생성
        'X-M2M-NM': config.nodeID+'_'+config.DevReset,						//해당 요청으로 생성하게 되는 자원의 이름 - Device Reset (NM == Name)
        'Content-Type': 'application/json;ty=12'							//JSON형태의 데이터 전송, ty == 12은 생성하고자 하는 mgmtCmd 자원을 의미함
      }
    },
    body: {mgc:{
    cmt : config.DevReset,   					//장치 제어 형태 (예, RepImmediate, DevReset, RepPerChange 등) / (cmt == cmdType)
    exe : true,             					//장치 제어를 위한 Trigger Attribute (true/false) / (exe == execEnable))
    ext : config.nodeRI     					//제어되는 장치의 식별자로 제어하고자 하는 장치의 <node> 자원 식별자를 명시함 (ext == exeTarget)
  }}
  });
//=============================================================================================================================//

//---------------------4. 장치 제어를 위한 device mgmtCmd DevReset 리소스 생성 요청 Response-----------------------------------//
}).then(function(result){
  console.log(colors.green('4. mgmtCmd 생성 결과'));
  if(result.statusCode == 409){
    console.log('이미 생성된 mgmtCmd 입니다.');
  }
  console.log('content-location: '+ result.headers['content-location']);		//생성된 자원의 URI
//=============================================================================================================================//


//---------------------------4. 장치 제어를 위한 device mgmtCmd RepPerChange 리소스 생성 요청----------------------------------//
  return httpReq({
    options: {
	  host: config.TPhost,
      port: config.TPport,
      path : '/'+config.AppEUI+'/'+config.version,
      method: 'POST',
      headers : {
        'Accept': 'application/json',											//Response 받을 형태를 JSON으로 설정
        dkey : config.dKey,														//mgmtCmd 생성을 위한 device Key (remoteCSE를 생성할때 발급)
        'X-M2M-Origin': config.nodeID,											//해당 요청 메시지 송신자의 식별자
        'X-M2M-RI': config.nodeID+'_'+randomInt(100000, 999999),				//해당 요청 메시지에 대한 고유 식별자 (RI == Request ID) / 해당 식별자는 CSE가 자동 생성
        'X-M2M-NM': config.nodeID+'_'+config.RepPerChange,						//해당 요청으로 생성하게 되는 자원의 이름 - RepPerChange (NM == Name)
        'Content-Type': 'application/json;ty=12'								//JSON형태의 데이터 전송, ty == 12은 생성하고자 하는 mgmtCmd 자원을 의미함
      }
    },
    body: {mgc:{
    cmt : config.RepPerChange,   				//장치 제어 형태 (예, RepImmediate, DevReset, RepPerChange 등) / (cmt == cmdType)
    exe : true,             					//장치 제어를 위한 Trigger Attribute (true/false) / (exe == execEnable))
    ext : config.nodeRI     					//제어되는 장치의 식별자로 제어하고자 하는 장치의 <node> 자원 식별자를 명시함 (ext == exeTarget)
  }}
  });
//=============================================================================================================================//

//---------------------4. 장치 제어를 위한 device mgmtCmd RepPerChange 리소스 생성 요청 Response-------------------------------//
}).then(function(result){
  console.log(colors.green('4. mgmtCmd 생성 결과'));
  if(result.statusCode == 409){
    console.log('이미 생성된 mgmtCmd 입니다.');
  }
  console.log('content-location: '+ result.headers['content-location']);		//생성된 자원의 URI
//=============================================================================================================================//


//---------------------------4. 장치 제어를 위한 device mgmtCmd RepImmediate 리소스 생성 요청----------------------------------//
  return httpReq({
    options: {
	  host: config.TPhost,
      port: config.TPport,
      path : '/'+config.AppEUI+'/'+config.version,
      method: 'POST',
      headers : {
        'Accept': 'application/json',											//Response 받을 형태를 JSON으로 설정
        dkey : config.dKey,														//mgmtCmd 생성을 위한 device Key (remoteCSE를 생성할때 발급)
        'X-M2M-Origin': config.nodeID,											//해당 요청 메시지 송신자의 식별자
        'X-M2M-RI': config.nodeID+'_'+randomInt(100000, 999999),				//해당 요청 메시지에 대한 고유 식별자 (RI == Request ID) / 해당 식별자는 CSE가 자동 생성
        'X-M2M-NM': config.nodeID+'_'+config.RepImmediate,						//해당 요청으로 생성하게 되는 자원의 이름 - RepImmediate (NM == Name)
        'Content-Type': 'application/json;ty=12'								//JSON형태의 데이터 전송, ty == 12은 생성하고자 하는 mgmtCmd 자원을 의미함
      }
    },
    body: {mgc:{
    cmt : config.RepImmediate,   				//장치 제어 형태 (예, RepImmediate, DevReset, RepPerChange 등) / (cmt == cmdType)
    exe : true,             					//장치 제어를 위한 Trigger Attribute (true/false) / (exe == execEnable))
    ext : config.nodeRI     					//제어되는 장치의 식별자로 제어하고자 하는 장치의 <node> 자원 식별자를 명시함 (ext == exeTarget)
  }}
//=============================================================================================================================//

//---------------------4. 장치 제어를 위한 device mgmtCmd RepImmediate 리소스 생성 요청 Response-------------------------------//
  }).then(function(result){
console.log(colors.green('4. mgmtCmd 생성 결과'));
  if(result.statusCode == 409){
    console.log('이미 생성된 mgmtCmd 입니다.');
  }
  console.log('content-location: '+ result.headers['content-location']);		//생성된 자원의 URI
  if(result.headers){
    console.log(colors.green('4. content Instance 주기적 생성 시작'));
	IntervalFunction = setInterval(IntervalProcess, UPDATE_CONTENT_INTERVAL);
  }
  });
//=============================================================================================================================//
}).catch(function(err){
  console.log(err);
});

//------------------------------5. 센서 데이터 전송을 위한 ContentInstance 리소스 생성 요청------------------------------------//
 function IntervalProcess(){
      var value_TEMP = Math.floor(Math.random() * 5) + BASE_TEMP;
	  var value_HUMID = Math.floor(Math.random() * 5) + BASE_HUMID;
	  var value_WIND = Math.floor(Math.random() * 5) + BASE_WIND;

    var value = value_TEMP.toString()+","+value_HUMID.toString()+","+value_WIND.toString()
    httpReq({
      options : {
		host: config.TPhost,
        port: config.TPport,
        path : '/'+config.AppEUI+'/'+config.version+'/remoteCSE-'+ config.nodeID+ '/container-'+config.containerName,
        method: 'POST',
        headers : {
          'Accept': 'application/json',											//Response 받을 형태를 JSON으로 설정
          'X-M2M-Origin': config.nodeID,										//해당 요청 메시지 송신자의 식별자
		  'X-M2M-RI': config.nodeID+'_'+randomInt(100000, 999999),				//해당 요청 메시지에 대한 고유 식별자 (RI == Request ID) / 해당 식별자는 CSE가 자동 생성
          'Content-Type': 'application/json;ty=4',								//JSON형태의 데이터 전송, ty == 4은 생성하고자 하는 contentInstance 자원을 의미함
		  dkey : config.dKey,													//contentInstance 생성을 위한 device Key (remoteCSE를 생성할때 발급)

        }
      },
      body : {cin:{
		cnf : 'text', 							//업로드 하는 데이터 타입의 정보 (cnf = contentInfo)
		con : value   							//업로드 하는 데이터 (con == content)
		}}
//=============================================================================================================================//

//-------------------------5. 센서 데이터 전송을 위한 ContentInstance 리소스 생성 요청 Response--------------------------------//
    }).then(function(result){

      var data = JSON.parse(result.data);
      console.log('content : ' + data.cin.con + ', resourceID : '+data.cin.ri); //업로드 된 자원의 데이터 정보
    }).catch(function(err){
		console.log(colors.red('#####################################'));
      console.log(err);
    });

    }
//=============================================================================================================================//

//----------------------------------------- 6. mgmtCmd 수행 결과 전달 updateExecInstance---------------------------------------//
function updateExecInstance(ei, mgmtCmdprefix){
  httpReq({
    options: {
		host: config.TPhost,
        port: config.TPport,
      path : '/'+config.AppEUI+'/'+config.version+'/mgmtCmd-'+mgmtCmdprefix+'/execInstance-'+ei,
      method: 'PUT',
      headers : {
        'Accept': 'application/json',										//Response 받을 형태를 JSON으로 설정
        dKey : config.dKey,													//execInstance 수행을 위한 device Key (remoteCSE를 생성할때 발급)
        'X-M2M-Origin': config.nodeID,										//해당 요청 메시지 송신자의 식별자
        'X-M2M-RI': config.nodeID+'_'+randomInt(100000, 999999),			//해당 요청 메시지에 대한 고유 식별자 (RI == Request ID) / 해당 식별자는 CSE가 자동 생성
        'Content-Type': 'application/json'									//JSON형태의 데이터 전송, ty == 4은 생성하고자 하는 contentInstance 자원을 의미함
      }
    },
    body : {}
//=============================================================================================================================//

//----------------------------------------- 6. mgmtCmd 수행 결과 전달 updateExecInstance Respon--------------------------------//
  }).then(function(result){
    var data = JSON.parse(result.data);
    console.log('처리한 resouceId : ' + data.ri);
    console.log('처리한 결과 execStatus : ' + data.exs);
    console.log(colors.red('#####################################'));
  }).catch(function(err){
    console.log(err);
  });
}
//=============================================================================================================================//
