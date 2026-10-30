/*g_device_data = {
    userLang: "en",
    area_code: "Trunk",
    operators_code: "CT",
    operator_name: "CH_CT",
    factory_mode: 0,
    lan_port_num: 4,
    usb_port_num: 1,
    voice_port_num: 1,
    wifi5: 1,
    wifi: 1,
    ssid_num: 8,
    user: "1",  // 1:user    2：admin    4.fiberhome
    pon_mode: 0,
    onu_type: 4,
    br0mac: "BE:CD:00:BE:CD:00",
    MainSSIDIndex_58G: 9,
    WANAccessType: "",
    IPInterfaceIPAddress: "192.168.1.1",
    wanInterface: "dev.eth.4",
    LockBandDisplay: "0",
    CarrierNumLocked: 0,
    remote_addr: "",
    Bridged: false,
}*/
require(["/js/util.js", "/lang/main_res.js"], function(){

    getLoginUser();
    refreshTimeout();
    addClassListMethod();

    initPageConfigure().then(function(){

        checkSessionTimeout();

        $post('get_device_info', null, "nocheck").then(function(getdata){
            if (getdata.i18n) {
                g_device_data.userLang = g_currentLang = getdata.i18n;
            }else{
                g_device_data.userLang = g_currentLang = "en"
            }

            if (g_currentLang == "zh") {
                g_baseLanguageSource = zh_lang_json;
            } else if (g_currentLang == "pl") {
                g_baseLanguageSource = pl_lang_json;
            } else {
                g_baseLanguageSource = en_lang_json;
            }
             
            g_device_data.operators_code = getdata.operators_code;
            g_device_data.area_code = getdata.area_code;
            if(getdata.operator_name == "PLDT" || getdata.operator_name == "PH_PLDT")
            {
                g_device_data.operator_name = "PLDT";
            }
            else if(getdata.operator_name == "DITO" || getdata.operator_name == "PH_DITO")
            {
                g_device_data.operator_name = "DITO";
            }
            else if (getdata.operator_name == "GLOBE" || getdata.operator_name == "PH_GLOBE")
            {
                g_device_data.operator_name = "GLOBE";
            }
            else
            {
                g_device_data.operator_name = getdata.operator_name;
            }
            if (g_device_data.operator_name == "PL_PLUS") {
                var link = document.getElementsByTagName("link")[0];
                if(link.rel == 'icon') {
                    link.href = "static/image/plus/plus.ico";
                }
                document.title = '5G CPE FiberHome'
            }else {
                var link = document.getElementsByTagName("link")[0];
                if(link.rel == 'icon') {
                    link.href = "static/image/favicon.ico";
                }
            }
            g_device_data.factory_mode = getdata.factory_mode;
            g_device_data.lan_port_num = getdata.port_num;
            g_device_data.usb_port_num = getdata.usb_num;
            g_device_data.voice_port_num = getdata.pots_num;
            g_device_data.wifi = getdata.wifi;
            g_device_data.wifi5 = getdata.wifi5;
            g_device_data.ssid_num = getdata.ssid_num;
            g_device_data.pon_mode = getdata.pon_mode;
            g_device_data.onu_type = getdata.onu_type;
            g_device_data.br0mac = getdata.brmac;
            g_device_data.remote_addr = getdata.remote_addr;
            g_device_data.band_n79 = getdata.band_n79 == "1" ? true : false;
            g_device_data.model_name = getdata.model_name;
            g_device_data.pwd_enable_flag = getdata.pwd_enable_flag == "1" ;
            g_device_data.apn_flag = getdata.apn_flag == "1" ;

            if(g_device_data.model_name == "LG6852F"){
                g_device_data.DeviceName = "5G CPE Max";
            }else if(g_device_data.model_name == "LG6120E"){
                g_device_data.DeviceName = "5G CPE";
            }else{
                g_device_data.DeviceName = "5G CPE Pro";
            }
            var getObj = {
                WANAccessType: x_WANDevice_1_obj + x_WANCommonInterfaceConfig_obj + x_WANAccessType,
                MainSSIDIndex_58G: x_MainSSIDIndex_58G_obj,
                IPInterfaceIPAddress: x_LANHostConfigManagement_obj + x_LANHost_IPInterface_1 + x_LANHost_IPInterfaceIPAddress,
                wanInterface: x_DeviceInfo_obj + x_DeviceInfo_WanInterface,
                SwitchAutoEnable: x_DeviceInfo_obj + x_DeviceInfo_SwitchAutoEnable,
                SIMStatus: x_SIM_1_obj + x_SIM_1_SIMStatus,
                PINCodeEnable: x_PINCodeManagement_obj + x_PINCode_PINCodeEnable,
                LockBandDisplay: x_NetworkSettings_obj + x_NetworkSet_LockBandDisplay,
                RemainingTimes: x_PINCodeManagement_obj + x_PINCode_RemainingTimes,
                VoiceEnable: x_DeviceInfo_obj + x_FH_VoiceEnable,
                CarrierLockEnable: x_NetworkSettings_obj + x_NetworkSet_CarrierLockEnable,
                CarrierSerialNum: x_NetworkSettings_obj + x_NetworkSet_CarrierSerialNum,
                IMSI: x_SIM_1_obj + x_SIM_1_IMSI,
                Airplane_on: x_NetworkSettings_obj + x_NetworkSet_AirplaneEnable,
                NetworkMode: x_SIM_1_obj + x_SIM_1_NetworkMode,
                PlatUrl : x_IotagtdConf_PlatUrl,
                PrivateNetwork: x_NetworkSettings_obj + x_NetworkSet_PrivateNetwork,
                meshEnable: x_MultiAP_obj + x_MultiAP_Enable,
                meshRole: x_MultiAP_obj + x_MultiAP_Mode,
                AggregationEnable: x_DeviceInfo_obj + x_DeviceInfo_AggregationEnable,
                ModemModel: x_DeviceInfo_obj + x_DeviceInfo_ModemModel,
                EthWanEnable:  x_DeviceInfo_obj + x_DeviceInfo_EthWanEnable
            };
            var allWanConnectionTypeObj = {
                url: x_WANDevice_obj,
                num: 2,
                node: {
                    waninterface: x_wan_WanInterface,
                    wanenable: x_wan_WANEnable,
                    wanconnection:{
                        url: x_WANConnectionDevice,
                        node: {
                            ipoe:{
                                url: x_WANIPConnection,
                                node: {
                                    ConnectionType: x_wan_ConnectionType,
                                }
                            },
                            pppoe:{
                                url: x_WANPPPConnection,
                                node: {
                                    ConnectionType: x_wan_ConnectionType,
                                }
                            },
                        }
                    }
                }
            }
            $multipost("get_value_by_xmlnode|get_xml_childnode_value", getObj,allWanConnectionTypeObj).then(function(data){
                var response = data.data_1;
                var wanData = data.data_2.data;
                if(response.NetworkMode)
                    g_device_data.NetworkMode = response.NetworkMode;
                if (response.WANAccessType)
                    g_device_data.WANAccessType = response.WANAccessType;
                if (response.MainSSIDIndex_58G)
                    g_device_data.MainSSIDIndex_58G = Number(response.MainSSIDIndex_58G);
                if (response.IPInterfaceIPAddress)
                    g_device_data.IPInterfaceIPAddress = response.IPInterfaceIPAddress;
                if (response.LockBandDisplay)
                    g_device_data.LockBandDisplay = response.LockBandDisplay;
                if (response.PINCodeEnable)
                    g_device_data.PINCodeEnable = response.PINCodeEnable;
                if (response.RemainingTimes)
                    g_device_data.RemainingTimes = response.RemainingTimes;
                if (response.VoiceEnable)
                    g_device_data.VoiceEnable = response.VoiceEnable;
                if (response.ModemModel)
                    g_device_data.ModemModel = response.ModemModel || "";
                if(response.CarrierLockEnable == 1)
                {
                    g_device_data.CarrierNumLocked = 1;
                    var serial_nums = [];
                    serial_nums = response.CarrierSerialNum.split(",");
                    for(var i=0; i<serial_nums.length; i++)
                    {
                        if(serial_nums[i].length == 0)
                        {
                            continue;
                        }
                        if(serial_nums[i].length <= response.IMSI.length && serial_nums[i] == response.IMSI.substr(0,serial_nums[i].length))
                        {
                            g_device_data.CarrierNumLocked = 0;
                            break;
                        }
                    }
                }
                else
                {
                    g_device_data.CarrierNumLocked = 0;
                }
                if (response.Airplane_on)
                    g_device_data.Airplane_on = response.Airplane_on;
                
                if (g_device_data.operator_name == "COMMON" && response.PlatUrl == "commoncpe.mifon.com") {
                    g_device_data.operator_name = "COMMON_INTL"
                }
                var ConnectionType = "";
                var thisData = [];
                g_device_data.AggregationEnable =  response.AggregationEnable == "1";
                g_device_data.SwitchAuto = (response.SwitchAutoEnable == "1" || response.AggregationEnable == "1") ? true : false;
                g_wanInterface = response.wanInterface;
                g_device_data.no_eth_flag = g_device_data.model_name == "LG6120E" && response.EthWanEnable == "0";

                if (g_device_data.SwitchAuto){
                    g_device_data.Bridged = false;
                }else{
                    for (var key=0; key<wanData.length; key++){
                        if (wanData[key].wanenable == "1") {
                            thisData = wanData[key].wanconnection;
                            break;
                        }
                    }
                    if (thisData.length > 0){
                        if(thisData[0].ipoe.length > 0){
                            ConnectionType = thisData[0].ipoe[0].ConnectionType;
                        }else if(thisData[0].pppoe.length > 0){
                            ConnectionType = thisData[0].pppoe[0].ConnectionType;
                        }
                    }

                    if (ConnectionType.indexOf("Bridged") > 0){
                        g_device_data.Bridged = true;
                    } else {
                        g_device_data.Bridged = false;
                    }
                }
                if (response.PrivateNetwork){
                    g_device_data.PrivateNetwork = response.PrivateNetwork == "1" ? true : false;
                }
                if (response.meshRole == "2" && response.meshEnable =="1"){
                    g_device_data.childMode = true;
                }else{
                    g_device_data.childMode = false;
                }
                g_device_data.meshEnable = response.meshEnable == "1";
                if(g_device_data.model_name == "LG6852F" && g_device_data.operator_name == "COMMON"){
                    g_device_data.hasMesh = true;
                }else{
                    g_device_data.hasMesh = false;
                }
                if((g_device_data.model_name == "LG6151M" || g_device_data.model_name == "LG6852F" || g_device_data.model_name == "LG6120E") && !g_device_data.childMode){
                    g_device_data.hasGuest = true;
                }else{
                    g_device_data.hasGuest = false;
                }
                requireIndex();
            })
        })
    })
})

function requireIndex(){
    require.config({
        paths: {
            'vue':'/plugins/vue.min',
            'vue-i18n':'/plugins/vue-i18n.min',
            'vue-router':'/plugins/vue-router.min',
            'router':'/src/router/router',
            'ELEMENT':'/plugins/element',
            'main_res':'/lang/'+g_device_data.userLang+'/main_res'
        }
    });
    require(['/js/global_var.js'], function() {
        require(['./index']);
    });
};
