var getRoute = function(componentName) {
    return function(resolve) {
        require([componentName], resolve);
    };
}

var meunDefault = [
        {
            path: '*',
            redirect: '/home'
        },
        {
            path: '/home',
            component:getRoute('content/pages/home'),
            meta: {
                title: 'home',
                icon: 'icon-fh-home',
                show: function() {
                   return true
                }
            }
        },
        {
            path: '/accountManagement',
            component:getRoute('content/pages/accountManagement'),
            meta: {
                title: 'accountManagement',
                icon: 'el-icon-info',
                show: function() {
                   return g_device_data.operator_name == "PLDT"
                }
            }
        },
        {
            path: '/SMS',
            component:getRoute('content/pages/sms'),
            meta: {
                title: 'sms',
                icon: 'el-icon-message',
                show: function() {
                    return g_device_data.CarrierNumLocked == 0 && g_device_data.operator_name == "PLDT" && !g_device_data.childMode;
                }
            }
        },
        {
            path: '/status',
            component:getRoute('content/pages/deviceInfo'),
            meta: {
                title: 'deviceInfo',
                icon: 'icon-fh-statusinfo',
                show: function() {
                    return g_device_data.model_name == "LG6120E"
                }
            }
        },
        {
            path: '/status',
            meta: {
                title: 'status',
                icon: 'icon-fh-statusinfo',
                show: function() {
                    return g_device_data.model_name != "LG6120E"
                }
            },
            children: 
            [
                {
                    path: '/status/deviceInfo',
                    component:getRoute('content/pages/deviceInfo'),
                    meta: {
                        title: 'deviceInfo',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/status/wifiStat',
                    component:getRoute('content/pages/wifiStat'),
                    meta: {
                        title: 'wifiStat',
                        icon: 'el-icon-upload',
                        show: function() {
                           return !g_device_data.childMode;
                        }
                    }
                },
                {
                    path: '/status/voiceSet',
                    component:getRoute('content/pages/voiceSet'),
                    meta: {
                        title: 'voiceSet',
                        icon: 'el-icon-upload',
                        show: function() {
                           return g_device_data.VoiceEnable == "1" && (g_wanInterface.indexOf('5G') > -1 || g_device_data.SwitchAuto) && !g_device_data.childMode;
                        }
                    }
                }
            ]
        },
        {
            path: '/mobileNetwork',
            meta: {
                title: 'mobileNetwork',
                icon: 'icon-fh-mobile',
                show: function() {
                    return (g_wanInterface.indexOf('5G') > -1 || g_device_data.SwitchAuto) && !g_device_data.childMode;
                }
            },
            children: 
            [
                {
                    path: '/status/trafficStat',
                    component:getRoute('content/pages/trafficStat'),
                    meta: {
                        title: 'trafficStat',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/mobileNetwork/simInfo',
                    component:getRoute('content/pages/simInfo'),
                    meta: {
                        title: 'simInfo',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/mobileNetwork/carrierAggregation',
                    component:getRoute('content/pages/carrierAggregation'),
                    meta: {
                        title: 'carrierAggregation',
                        icon: 'el-icon-upload',
                        show: function() {
                           return (g_device_data.operator_name == "COMMON_INTL" || g_device_data.operator_name == "COMMON_EUR" || g_device_data.operator_name == "COMMON_NA" || g_device_data.operator_name == "COMMON" || g_device_data.operator_name == "SA_STC" || g_device_data.operator_name == "KEN_SARAFI" || g_device_data.operator_name == "PL_PLUS" || g_device_data.operator_name == "LEISHEN")  && g_device_data.NetworkMode != "1" && g_device_data.model_name != "LG6120E"
                        }
                    }
                },
                {
                    path: '/mobileNetworkvolteCalls',
                    component:getRoute('content/pages/volteCalls'),
                    meta: {
                        title: 'volteCalls',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  g_device_data.operator_name == "PL_PLUS";
                        }
                    }
                },
                {
                    path: '/mobileNetwork/configManage',
                    component:getRoute('content/pages/configManage'),
                    meta: {
                        title: 'configManage',
                        icon: 'el-icon-upload',
                        show: function() {
                           return (g_device_data.operator_name != "IDN_SURGE" || g_device_data.apn_flag)
                        }
                    }
                },
                {
                    path: '/mobileNetwork/networkSet',
                    component:getRoute('content/pages/networkSet'),
                    meta: {
                        title: 'networkSet',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/mobileNetwork/rfSignal',
                    component:getRoute('content/pages/rfSignal'),
                    meta: {
                        title: 'rfSignal',
                        icon: 'el-icon-upload',
                        show: function() {
                            return  (g_device_data.user == "3" || g_device_data.operator_name == "COMMON" 
                                || g_device_data.operator_name == "COMMON_INTL" || g_device_data.operator_name == "COMMON_EUR" 
                                || g_device_data.operator_name == "COMMON_NA" || g_device_data.operator_name == "PLDT" 
                                || g_device_data.operator_name == "SA_STC" || g_device_data.operator_name == "KEN_SARAFI" 
                                || g_device_data.operator_name == "LEISHEN" || g_device_data.operator_name == "PL_PLUS" 
                            ) && g_device_data.model_name != "LG6120E"
                        }
                    }
                },
                {
                    path: '/mobileNetwork/rfSignalIdn',
                    component:getRoute('content/pages/rfSignalIdn'),
                    meta: {
                        title: 'rfSignal',
                        icon: 'el-icon-upload',
                        show: function() {
                            return   g_device_data.operator_name == "IDN_EMR" || g_device_data.operator_name == "IDN_SURGE"
                        }
                    }
                },
                {
                    path: '/mobileNetwork/voiceConfig',
                    component:getRoute('content/pages/voiceConfig'),
                    meta: {
                        title: 'voiceConfig',
                        icon: 'el-icon-upload',
                        show: function() {

                            return  g_device_data.VoiceEnable == "1" && g_device_data.user == "3" && g_device_data.model_name != "LG6120E"
                        }
                    }
                },

                {
                    path: '/mobileNetwork/atCommand',
                    component:getRoute('content/pages/atCommand'),
                    meta: {
                        title: 'atCommand',
                        icon: 'el-icon-upload',
                        show: function() {
                            return g_device_data.user == "3";
                        }
                    }
                },
                {
                    path: '/mobileNetwork/carrierLock',
                    component:getRoute('content/pages/carrierLock'),
                    meta: {
                        title: 'carrierLock',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  g_device_data.operator_name != "COMMON" && g_device_data.operator_name != "COMMON_INTL" 
                           && g_device_data.operator_name != "COMMON_EUR" && g_device_data.operator_name != "COMMON_NA" 
                           && g_device_data.operator_name != "SA_STC" && g_device_data.operator_name != "KEN_SARAFI" 
                           && g_device_data.operator_name != "PL_PLUS" && g_device_data.operator_name != "LEISHEN"
                           && g_device_data.operator_name != "IDN_EMR" && g_device_data.operator_name != "IDN_SURGE" 
                           && g_device_data.user == "3";
                        }
                    }
                },
                {
                    path: '/mobileNetwork/antennaSet',
                    component:getRoute('content/pages/antennaSet'),
                    meta: {
                        title: 'antennaSet',
                        icon: 'el-icon-upload',
                        show: function() {
                            return g_device_data.model_name != "LG6151M" && g_device_data.model_name != "LG6120E";
                        }
                    }
                },
                {
                    path: '/mobileNetwork/frequencyLockSet',
                    component:getRoute('content/pages/frequencyLockSet'),
                    meta: {
                        title: 'frequencyLockSet',
                        icon: 'el-icon-upload',
                        show: function(){
                            if(g_device_data.operator_name == "COMMON" || g_device_data.operator_name == "COMMON_INTL" 
                                || g_device_data.operator_name == "COMMON_EUR" || g_device_data.operator_name == "COMMON_NA" 
                                || g_device_data.operator_name == "SA_STC" || g_device_data.operator_name == "KEN_SARAFI" 
                                || g_device_data.operator_name == "PL_PLUS" || g_device_data.operator_name == "LEISHEN" 
                                || g_device_data.operator_name == "IDN_EMR" || g_device_data.operator_name == "IDN_SURGE")
                            {
                                return false;
                            }
                            else
                            {
                                return g_device_data.user == "3" && g_device_data.LockBandDisplay == "1";
                            }
                        }
                    }
                },
                {
                    path: '/mobileNetwork/SMS',
                    meta: {
                        title: 'sms',
                        icon: 'el-icon-message',
                        show: function() {
                           return (g_device_data.CarrierNumLocked == 0 && g_device_data.operator_name != "PLDT" && g_device_data.operator_name != "IDN_SURGE")
                        }
                    },
                    children: 
                    [
                        {
                            path: '/mobileNetwork/SMS/smsEnable',
                            component:getRoute('content/pages/smsEnable'),
                            meta: {
                                title: 'sms_enable',
                                show: function() {
                                   return g_device_data.operator_name == "COMMON" || g_device_data.operator_name == "COMMON_INTL" 
                                   || g_device_data.operator_name == "COMMON_EUR" || g_device_data.operator_name == "COMMON_NA" 
                                   || g_device_data.operator_name == "SA_STC" || g_device_data.operator_name == "KEN_SARAFI" 
                                   || g_device_data.operator_name == "LEISHEN"
                                }
                            }
                        },
                        {
                            path: '/mobileNetwork/SMS/smsRecv',
                            component:getRoute('content/pages/sms'),
                            meta: {
                                title: 'sms_rcv',
                                show: function() {
                                   return g_device_data.operator_name != "COMMON" && g_device_data.operator_name != "COMMON_INTL" 
                                   && g_device_data.operator_name != "COMMON_EUR" && g_device_data.operator_name != "COMMON_NA" 
                                   && g_device_data.operator_name != "SA_STC" && g_device_data.operator_name != "KEN_SARAFI" 
                                   && g_device_data.operator_name != "PL_PLUS" && g_device_data.operator_name != "LEISHEN"
                                   && g_device_data.operator_name != "IDN_EMR" && g_device_data.operator_name != "IDN_SURGE"
                                }
                            }
                        },
                        {
                            path: '/mobileNetwork/SMS/smsSend',
                            component:getRoute('content/pages/sms_send'),
                            meta: {
                                title: 'sms_send',
                                show: function() {
                                   return g_device_data.operator_name != "COMMON" && g_device_data.operator_name != "COMMON_INTL" 
                                   && g_device_data.operator_name != "COMMON_EUR" && g_device_data.operator_name != "COMMON_NA" 
                                   && g_device_data.operator_name != "SA_STC" && g_device_data.operator_name != "KEN_SARAFI" 
                                   && g_device_data.operator_name != "PL_PLUS" && g_device_data.operator_name != "LEISHEN"
                                   && g_device_data.operator_name != "IDN_EMR" && g_device_data.operator_name != "IDN_SURGE"
                                }
                            }
                        },
                        {
                            path: '/mobileNetwork/SMS/smsInbox',
                            component:getRoute('content/pages/smsInbox'),
                            meta: {
                                title: 'sms_inbox',
                                show: function() {
                                   return g_device_data.operator_name == "COMMON" || g_device_data.operator_name == "COMMON_INTL" 
                                   || g_device_data.operator_name == "COMMON_EUR" || g_device_data.operator_name == "COMMON_NA" 
                                   || g_device_data.operator_name == "SA_STC" || g_device_data.operator_name == "KEN_SARAFI" 
                                   || g_device_data.operator_name == "PL_PLUS" || g_device_data.operator_name == "LEISHEN"
                                   || g_device_data.operator_name == "IDN_EMR"
                                }
                            }
                        }
                    ]
                },
            ]
        },
        {
            path: '/networkInfo',
            component:getRoute('content/pages/networkInfo'),
            meta: {
                title: 'networkInfo',
                icon: 'icon-fh-netinfo',
                show: function() {
                   return !g_device_data.childMode && g_device_data.operator_name != 'IDN_SURGE';
                }
            }
        },
        {
            path: '/networkInfoMulti',
            component:getRoute('content/pages/networkInfoMulti'),
            meta: {
                title: 'networkInfo',
                icon: 'icon-fh-netinfo',
                show: function() {
                   return !g_device_data.childMode && g_device_data.operator_name == 'IDN_SURGE';
                }
            }
        },
        {
            path: '/network',
            meta: {
                title: 'network',
                icon: 'icon-fh-setting',
                show: function() {
                   return !g_device_data.childMode;
                }
            },
            children: 
            [
                {
                    path: '/network/networkConn',
                    component:getRoute('content/pages/networkConn'),
                    meta: {
                        title: 'networkConfig',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/network/lanSet',
                    meta: {
                        title: 'lanSet',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    },
                    children: 
                    [
                        {
                            path: '/network/lanSet/ipv4Settings',
                            component:getRoute('content/pages/ipv4Settings'),
                            meta: {
                                title: 'ipv4Settings',
                                icon: 'el-icon-upload',
                                show: function() {
                                   return true
                                }
                            }
                        },
                        {
                            path: '/network/lanSet/ipv6Settings',
                            component:getRoute('content/pages/ipv6Settings'),
                            meta: {
                                title: 'ipv6Settings',
                                icon: 'el-icon-upload',
                                show: function() {
                                   return !g_device_data.Bridged
                                }
                            }
                        },
                        
                        {
                            path: '/network/lanSet/dhcpStaticSettings',
                            component: getRoute('content/pages/dhcpStaticSettings'),
                            meta: {
                                title: 'dhcpStaticSettings',
                                icon: 'el-icon-upload',
                                show: function () {
                                    return (g_device_data.user == "3" || g_device_data.operator_name == "COMMON" 
                                        || g_device_data.operator_name == "COMMON_INTL" || g_device_data.operator_name == "COMMON_EUR" 
                                        || g_device_data.operator_name == "COMMON_NA" || g_device_data.operator_name == "SA_STC" 
                                        || g_device_data.operator_name == "KEN_SARAFI" || g_device_data.operator_name == "PL_PLUS" 
                                        || g_device_data.operator_name == "LEISHEN" || g_device_data.operator_name == "IDN_EMR" 
                                        || g_device_data.operator_name == "IDN_SURGE")
                                }
                            }
                        },
                        {
                            path: '/network/ipv4LanRoute',
                            component:getRoute('content/pages/ipv4LanRoute'),
                            meta: {
                                title: 'routeSet',
                                icon: 'el-icon-upload',
                                show: function() {
                                return g_device_data.operator_name == "COMMON" && (g_device_data.model_name == "LG6151M" || g_device_data.model_name == "LG6851F")
                                }
                            }
                        }
                    ]
                },
                {
                    path: '/network/acsServer',
                    component:getRoute('content/pages/acsServer'),
                    meta: {
                        title: 'acsServer',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  g_device_data.user == "3"
                        }
                    }
                }
            ]
        },
        {
            path: '/wifiConfig',
            meta: {
                title: 'wifiConfig',
                icon: 'icon-fh-wifi',
                show: function() {
                   return true
                }
            },
            children: 
            [
                {
                    path: '/wifiConfig/wifiBasic',
                    component:getRoute('content/pages/wifiBasic'),
                    meta: {
                        title: 'wifiBasic',
                        icon: 'el-icon-upload',
                        show: function() {
                           return !g_device_data.childMode;
                        }
                    }
                },
                {
                    path: '/wifiConfig/wifiAdvanced',
                    component:getRoute('content/pages/wifiAdvanced'),
                    meta: {
                        title: 'wifiAdvanced',
                        icon: 'el-icon-upload',
                        show: function() {
                           return !g_device_data.childMode;
                        }
                    }
                },
                {
                    path: '/wifiConfig/wifiBasic_5g',
                    component:getRoute('content/pages/wifiBasic_5g'),
                    meta: {
                        title: '5GwifiBasic',
                        icon: 'el-icon-upload',
                        show: function() {
                            return !g_device_data.childMode;
                        }
                    }
                },
                {
                    path: '/wifiConfig/wifiAdvanced_5g',
                    component:getRoute('content/pages/wifiAdvanced_5g'),
                    meta: {
                        title: '5GwifiAdvanced',
                        icon: 'el-icon-upload',
                        show: function() {
                            return !g_device_data.childMode;
                        }
                    }
                },
                {
                    path: '/wifiConfig/wifiGuest',
                    component:getRoute('content/pages/wifiGuest'),
                    meta: {
                        title: 'wifiGuest',
                        show: function() {
                            return g_device_data.hasGuest;
                        }
                    }
                },
                {
                    path: '/wifiConfig/wifiInone',
                    component:getRoute('content/pages/wifiInone'),
                    meta: {
                        title: 'wifiInone',
                        icon: 'el-icon-upload',
                        show: function() {
                           return (g_device_data.model_name == "LG6151M" || g_device_data.model_name == "LG6852F" || g_device_data.model_name == "LG6120E") && !g_device_data.childMode;
                        }
                    }
                },
                {
                    path: '/wifiConfig/multiLink',
                    component:getRoute('content/pages/multiLink'),
                    meta: {
                        title: 'multiLink',
                        icon: 'el-icon-upload',
                        show: function() {
                           return g_device_data.model_name == "LG6851F";
                        }
                    }
                },
                {
                    path: '/wifiConfig/multiLink',
                    component:getRoute('content/pages/multiLinkPrinciple'),
                    meta: {
                        title: 'multiLink',
                        icon: 'el-icon-upload',
                        show: function() {
                           return (g_device_data.model_name == "LG6151M" || g_device_data.model_name == "LG6852F") && !g_device_data.childMode;
                        }
                    }
                },
                {
                    path: '/wifiConfig/wps',
                    component:getRoute('content/pages/wps'),
                    meta: {
                        title: 'wps',
                        icon: 'el-icon-upload',
                        show: function() {
                           return !g_device_data.meshEnable;
                        }
                    }
                },
                {
                    path: '/wifiConfig/neighbor',
                    component:getRoute('content/pages/neighbor'),
                    meta: {
                        title: 'neighbor',
                        icon: 'el-icon-upload',
                        show: function() {
                           return !g_device_data.childMode && g_device_data.model_name != "LG6120E";
                        }
                    }
                },
                {
                    path: '/wifiConfig/mesh',
                    component:getRoute('content/pages/mesh'),
                    meta: {
                        title: 'meshSet',
                        icon: 'el-icon-upload',
                        show: function() {
                            return g_device_data.hasMesh;
                        }
                    }
                }
            ]
        },
        {
            path: '/device',
            component:getRoute('content/pages/device'),
            meta: {
                title: 'device',
                icon: 'icon-fh-terminal',
                show: function() {
                   return g_device_data.operator_name != "COMMON" && g_device_data.operator_name != "COMMON_INTL" 
                   && g_device_data.operator_name != "COMMON_EUR" && g_device_data.operator_name != "COMMON_NA" 
                   && g_device_data.operator_name != "SA_STC" && g_device_data.operator_name != "KEN_SARAFI" 
                   && g_device_data.operator_name != "PL_PLUS" && g_device_data.operator_name != "LEISHEN"  
                   && g_device_data.operator_name != "COMMON_NA" &&  g_device_data.operator_name != "IDN_EMR" 
                   && g_device_data.operator_name != "IDN_SURGE"
                   
                }
            }
        },
        {
            path: '/device',
            meta: {
                title: 'device',
                icon: 'icon-fh-terminal',
                show: function() {
                   return (g_device_data.operator_name == "COMMON" || g_device_data.operator_name == "COMMON_INTL" 
                    || g_device_data.operator_name == "COMMON_EUR" || g_device_data.operator_name == "COMMON_NA" 
                    || g_device_data.operator_name == "SA_STC" || g_device_data.operator_name == "KEN_SARAFI" 
                    || g_device_data.operator_name == "PL_PLUS" || g_device_data.operator_name == "LEISHEN" 
                    || g_device_data.operator_name == "COMMON_NA" ||  g_device_data.operator_name == "IDN_EMR" 
                    || g_device_data.operator_name == "IDN_SURGE") && !g_device_data.childMode;
                }
            },
            children: 
            [
                {
                    path: '/device/onlneDevice',
                    component:getRoute('content/pages/device'),
                    meta: {
                        title: 'onlneDevice',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/device/offlineDevice',
                    component:getRoute('content/pages/deviceOffline'),
                    meta: {
                        title: 'offlineDevice',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/device/subrouter',
                    component:getRoute('content/pages/subrouter'),
                    meta: {
                        title: 'subrouter',
                        icon: 'icon-fh-terminal',
                        show: function() {
                           return g_device_data.hasMesh;
                        }
                    }
                }
            ]
        },
        {
            path: '/security',
            meta: {
                title: 'security',
                icon: 'icon-fh-safe',
                show: function() {
                   return !g_device_data.Bridged && !g_device_data.childMode;
                }
            },
            children: 
            [
                {
                    path: '/security/firewall',
                    component:getRoute('content/pages/firewall'),
                    meta: {
                        title: 'firewall',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/security/parentControl',
                    component:getRoute('content/pages/parentControl'),
                    meta: {
                        title: 'parentControl',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/security/macFilter',
                    component:getRoute('content/pages/macFilter'),
                    meta: {
                        title: 'macFilter',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/security/ipFilter',
                    component:getRoute('content/pages/ipFilter'),
                    meta: {
                        title: 'ipFilter',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/security/aclSet',
                    component:getRoute('content/pages/aclSet'),
                    meta: {
                        title: 'aclSet',
                        icon: 'el-icon-upload',
                        show: function() {
                        return false;
                        //    return  g_device_data.operators_code == "INTL" && g_device_data.operator_name != "COMMON" && g_device_data.operator_name != "LEISHEN";
                        }
                    }
                },
                {
                    path: '/security/natSet',
                    component:getRoute('content/pages/natSet'),
                    meta: {
                        title: 'natSet',
                        icon: 'el-icon-upload',
                        show: function() {
                           return g_device_data.model_name != "LG6120E"
                        }
                    }
                }

            ]
        },
        {
            path: '/developer',
            meta: {
                title: 'developer',
                icon: 'el-icon-warning',
                show: function() {
                   return (g_device_data.operator_name == "COMMON" || g_device_data.operator_name == "COMMON_INTL" 
                    || g_device_data.operator_name == "COMMON_EUR" || g_device_data.operator_name == "COMMON_NA" 
                    || g_device_data.operator_name == "SA_STC" || g_device_data.operator_name == "KEN_SARAFI" 
                    || g_device_data.operator_name == "PL_PLUS" || g_device_data.operator_name == "LEISHEN" 
                    || g_device_data.operator_name == "COMMON_NA" || g_device_data.operator_name == "IDN_EMR" 
                    || g_device_data.operator_name == "IDN_SURGE") && !g_device_data.childMode;
                }
            },
            children:
            [
                {
                    path: '/developer/carrierLock',
                    component:getRoute('content/pages/carrierLock'),
                    meta: {
                        title: 'carrierLock',
                        icon: 'el-icon-upload',
                        show: function() {
                            return g_device_data.user == "3" && (g_wanInterface.indexOf('5G') > -1 || g_device_data.SwitchAuto) && g_device_data.operator_name != "SA_STC" && g_device_data.model_name != "LG6120E";
                        }
                    }
                },
                {
                    path: '/developer/cellLockSet',
                    component:getRoute('content/pages/cellLockSet'),
                    meta: {
                        title: 'cellLockSet',
                        icon: 'el-icon-upload',
                        show: function(){
                            return (g_wanInterface.indexOf('5G') > -1 || g_device_data.SwitchAuto) && g_device_data.model_name != "LG6120E";
                        }
                    }
                },
                {
                    path: '/developer/cellLockBatchSet',
                    component:getRoute('content/pages/cellLockBatchSet'),
                    meta: {
                        title: 'cellLockSet',
                        icon: 'el-icon-upload',
                        show: function(){
                            return (g_wanInterface.indexOf('5G') > -1 || g_device_data.SwitchAuto) && g_device_data.operator_name == "IDN_EMR";
                        }
                    }
                },
                {
                    path: '/developer/frequencyLockSet',
                    component:getRoute('content/pages/frequencyLockSet'),
                    meta: {
                        title: 'frequencyLockSet',
                        icon: 'el-icon-upload',
                        show: function(){
                            return (g_wanInterface.indexOf('5G') > -1 || g_device_data.SwitchAuto) && g_device_data.model_name != "LG6120E"
                        }
                    }
                },
                {
                    path: '/developer/pccLock',
                    component:getRoute('content/pages/pccLock'),
                    meta: {
                        title: 'pccLock',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  false;
                        }
                    }
                },
                {
                    path: '/developer/wifiAreaCode',
                    component:getRoute('content/pages/wifiAreaCode'),
                    meta: {
                        title: 'wifiAreaCode',
                        icon: 'el-icon-upload',
                        show: function() {
                           return g_device_data.model_name != "LG6120E"
                        }
                    }
                },
                {
                    path: '/developer/debugInfo',
                    component:getRoute('content/pages/debugInfo'),
                    meta: {
                        title: 'debugInfo',
                        icon: 'el-icon-upload',
                        show: function() {
                            return g_device_data.user == "3";
                        }
                    }
                },
                {
                    path: '/developer/netDetection',
                    component:getRoute('content/pages/netDetection'),
                    meta: {
                        title: 'netDetection',
                        icon: 'el-icon-upload',
                        show: function() {
                            return (g_device_data.operator_name == "COMMON" || g_device_data.operator_name == "LEISHEN" 
                                || g_device_data.operator_name == "IDN_EMR") 
                                && (g_wanInterface.indexOf('5G') > -1 || g_device_data.SwitchAuto) && !g_device_data.PrivateNetwork;
                        }
                    }
                },
                {
                    path: '/developer/pinManagement',
                    component:getRoute('content/pages/pinManagement'),
                    meta: {
                        title: 'pinManagement',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  (g_wanInterface.indexOf('5G') > -1 || g_device_data.SwitchAuto)  && g_device_data.operator_name != "PL_PLUS" && g_device_data.model_name != "LG6120E";
                        }
                    }
                },
                {
                    path: '/developer/pinManagementNew',
                    component:getRoute('content/pages/pinManagementNew'),
                    meta: {
                        title: 'pinManagement',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  (g_wanInterface.indexOf('5G') > -1 || g_device_data.SwitchAuto)  && g_device_data.model_name == "LG6120E";
                        }
                    }
                },
                {
                    path: '/developer/privateNetwork',
                    component:getRoute('content/pages/privateNetwork'),
                    meta: {
                        title: 'privateNetwork',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  (g_wanInterface.indexOf('5G') > -1 || g_device_data.SwitchAuto) && g_device_data.operator_name == "COMMON" && g_device_data.model_name != "LG6120E"; 
                        }
                    }
                },
            ]
        },
        {
            path: '/application',
            meta: {
                title: 'application',
                icon: 'icon-fh-apps',
                show: function() {
                   return !g_device_data.childMode;
                }
            },
            children: 
            [
                {
                    path: '/application/algSet',
                    component:getRoute('content/pages/algSet'),
                    meta: {
                        title: 'algSet',
                        icon: 'el-icon-upload',
                        show: function() {
                            if (g_device_data.Bridged){
                                return false
                            } else {
                                return  g_device_data.user == "3"
                            }
                        }
                    }
                },
                {
                    path: '/application/vpnSet',
                    meta: {
                        title: 'vpnSet',
                        icon: 'el-icon-upload',
                        show: function() {
                           return !g_device_data.Bridged
                        }
                    },
                    children: 
                    [
                        {
                            path: '/application/vpnSet/l2tp',
                            component:getRoute('content/pages/l2tpSet'),
                            meta: {
                                title: 'l2tpSet',
                                icon: 'el-icon-upload',
                                show: function() {
                                   return true
                                }
                            }
                        },
                        {
                            path: '/application/vpnSet/pptp',
                            component:getRoute('content/pages/pptpSet'),
                            meta: {
                                title: 'pptpSet',
                                icon: 'el-icon-upload',
                                show: function() {
                                   return true
                                }
                            }
                        },
                        {
                            path: '/application/vpnSet/ipsec',
                            component:getRoute('content/pages/ipsecSet'),
                            meta: {
                                title: 'ipsecSet',
                                icon: 'el-icon-upload',
                                show: function() {
                                   return true
                                }
                            }
                        },
                        {
                            path: '/application/vpnSet/staticRoute',
                            component:getRoute('content/pages/staticRoute'),
                            meta: {
                                title: 'staticRoute',
                                icon: 'el-icon-upload',
                                show: function() {
                                    return true
                                }
                            }
                        },
                    ]
                },
                {
                    path: '/application/dmzSet',
                    component:getRoute('content/pages/dmzSet'),
                    meta: {
                        title: 'dmzSet',
                        icon: 'el-icon-upload',
                        show: function() {
                           return !g_device_data.Bridged
                        }
                    }
                },
                {
                    path: '/application/portForward',
                    component:getRoute('content/pages/portForward'),
                    meta: {
                        title: 'portForward',
                        icon: 'el-icon-upload',
                        show: function() {
                           return !g_device_data.Bridged
                        }
                    }
                },
                {
                    path: '/application/diagnosis',
                    meta: {
                        title: 'diagnosis',
                        icon: 'el-icon-upload',
                        show: function() {
                           return !g_device_data.Bridged
                        }
                    },
                    children: 
                    [
                        {
                            path: '/application/diagnosis/ping',
                            component:getRoute('content/pages/ping'),
                            meta: {
                                title: 'ping',
                                icon: 'el-icon-upload',
                                show: function() {
                                   return true
                                }
                            }
                        },
                        {
                            path: '/application/diagnosis/traceroute',
                            component:getRoute('content/pages/traceroute'),
                            meta: {
                                title: 'traceroute',
                                icon: 'el-icon-upload',
                                show: function() {
                                   return true
                                }
                            }
                        }
                    ]
                },
                {
                    path: '/application/upnpSet',
                    component:getRoute('content/pages/upnpSet'),
                    meta: {
                        title: 'upnpSet',
                        icon: 'el-icon-upload',
                        show: function() {
                            if (g_device_data.Bridged){
                                return false
                            } else {
                                return (g_device_data.operator_name == "COMMON" || g_device_data.operator_name == "COMMON_INTL" 
                                    || g_device_data.operator_name == "COMMON_EUR" || g_device_data.operator_name == "COMMON_NA" 
                                    || g_device_data.operator_name == "SA_STC" || g_device_data.operator_name == "KEN_SARAFI" 
                                    || g_device_data.operator_name == "PL_PLUS" || g_device_data.operator_name == "LEISHEN" 
                                    || g_device_data.operator_name == "IDN_EMR" || g_device_data.operator_name == "IDN_SURGE"
                                    || g_device_data.user == "3" 
                                    )
                            }
                        }
                    }
                },
                {
                    path: '/application/ddnsSet',
                    component:getRoute('content/pages/ddnsSet'),
                    meta: {
                        title: 'ddnsSet',
                        icon: 'el-icon-upload',
                        show: function() {
                            if (g_device_data.Bridged){
                                return false
                            } else {
                                return (g_device_data.operator_name == "COMMON" || g_device_data.operator_name == "COMMON_INTL" || g_device_data.operator_name == "COMMON_EUR" || g_device_data.operator_name == "COMMON_NA" || g_device_data.operator_name == "SA_STC" || g_device_data.operator_name == "KEN_SARAFI" || g_device_data.operator_name == "PL_PLUS" || g_device_data.operator_name == "LEISHEN" || g_device_data.user == "3") && g_device_data.model_name != "LG6120E"
                            }
                        }
                    }
                },
                {
                    path: '/application/nfc',
                    component:getRoute('content/pages/nfc'),
                    meta: {
                        title: 'nfcSet',
                        icon: 'el-icon-upload',
                        show: function() {
                           return g_device_data.model_name != "LG6151M" && g_device_data.model_name != "LG6120E";
                        }
                    }
                },
                {
                    path: '/application/led',
                    component:getRoute('content/pages/led'),
                    meta: {
                        title: 'ledSleep',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/application/fanControl',
                    component:getRoute('content/pages/fanControl'),
                    meta: {
                        title: 'fanControl',
                        icon: 'el-icon-upload',
                        show: function() {
                           return g_device_data.model_name != "LG6120E"
                        }
                    }
                },
            ]
        },
        {
            path: '/management',
            meta: {
                title: 'management',
                icon: 'el-icon-s-custom',
                show: function() {
                   return true
                }
            },
            children: 
            [
                {
                    path: '/management/userAccount',
                    component:getRoute('content/pages/userAccount'),
                    meta: {
                        title: 'userAccount',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/management/backupRecover',
                    component:getRoute('content/pages/backupRecover'),
                    meta: {
                        title: 'backupRecover',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  g_device_data.user == "3" || g_device_data.operator_name == "PL_PLUS"
                        }
                    }
                },
                {
                    path: '/management/restore',
                    component:getRoute('content/pages/restore'),
                    meta: {
                        title: 'restore',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/management/localUp',
                    component:getRoute('content/pages/localUp'),
                    meta: {
                        title: 'upgrade',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  g_device_data.user == "3" && g_device_data.model_name == "LG6120E"
                        }
                    }
                },
                {
                    path: '/management/localUp',
                    component:getRoute('content/pages/localUp'),
                    meta: {
                        title: 'localUp',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  g_device_data.user == "3" && ((g_device_data.operator_name == "COMMON" || g_device_data.operator_name == "PL_PLUS" ||  g_device_data.operator_name == "LEISHEN") && g_device_data.Bridged ||
                                    (g_device_data.operator_name != "COMMON" && g_device_data.operator_name != "PL_PLUS" && g_device_data.operator_name != "LEISHEN")) && g_device_data.model_name != "LG6120E"
                        }
                    }
                },
                {
                    path: '/management/localUp',
                    meta: {
                        title: 'UpManagement',
                        icon: 'el-icon-upload',
                        show: function() {
                           return (g_device_data.operator_name == "COMMON" || g_device_data.operator_name == "PL_PLUS" || g_device_data.operator_name == "LEISHEN") && !g_device_data.Bridged && g_device_data.model_name != "LG6120E" 
                        }
                    },
                    children: 
                    [
                        {
                            path: '/management/localUp/remoteUp',
                            component:getRoute('content/pages/remoteUp'),
                            meta: {
                                title: 'remoteUp',
                                icon: 'el-icon-upload',
                                show: function() {
                                   return true
                                }
                            }
                        },
                        {
                            path: '/management/localUp/localUp',
                            component:getRoute('content/pages/localUp'),
                            meta: {
                                title: 'localUp',
                                icon: 'el-icon-upload',
                                show: function() {
                                   return g_device_data.user == "3"
                                }
                            }
                        },
                        {
                            path: '/management/localUp/versionUp',
                            component:getRoute('content/pages/versionUp'),
                            meta: {
                                title: 'versionUp',
                                icon: 'el-icon-upload',
                                show: function() {
                                   return true
                                }
                            }
                        }
                    ]
                },
                {
                    path: '/management/ntp',
                    component:getRoute('content/pages/ntp'),
                    meta: {
                        title: 'ntp',
                        icon: 'el-icon-upload',
                        show: function() {
                           return !g_device_data.Bridged && !g_device_data.childMode;
                        }
                    }
                },
                {
                    path: '/management/ftp',
                    component:getRoute('content/pages/ftp'),
                    meta: {
                        title: 'ftp',
                        icon: 'el-icon-upload',
                        show: function() {
                           return false
                        }
                    }
                },
                {
                    path: '/management/appCode',
                    component:getRoute('content/pages/appCode'),
                    meta: {
                        title: 'appCode',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  g_device_data.operator_name == "COMMON" && g_device_data.model_name != "LG6120E"
                        }
                    }
                },
                {
                    path: '/management/reboot',
                    component:getRoute('content/pages/reboot'),
                    meta: {
                        title: 'reboot',
                        icon: 'el-icon-upload',
                        show: function() {
                           return true
                        }
                    }
                },
                {
                    path: '/management/log/logManagement',
                    component:getRoute('content/pages/logManagement'),
                    meta: {
                        title: 'logManagement',
                        icon: 'el-icon-upload',
                        show: function() {
                           return g_device_data.user == "3" || (g_device_data.user == "1" && g_device_data.model_name != "LG6120E") 
                        }
                    },
                },
                {
                    path: '/management/portMirror',
                    component:getRoute('content/pages/portMirror'),
                    meta: {
                        title: 'portMirror',
                        icon: 'el-icon-upload',
                        show: function() {
                            return g_device_data.user == "3" && (g_device_data.model_name != "LG6120E" || (g_device_data.model_name == "LG6120E" && g_wanInterface.indexOf('5G') > -1))

                        }
                    }
                },
                {
                    path: '/management/tr069InformStatus',
                    component:getRoute('content/pages/tr069InformStatus'),
                    meta: {
                        title: 'tr069InformStatus',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  g_device_data.user == "3" && !g_device_data.childMode;
                        }
                    }
                },
                {
                    path: '/management/debugInfo',
                    component:getRoute('content/pages/debugInfo'),
                    meta: {
                        title: 'debugInfo',
                        icon: 'el-icon-upload',
                        show: function() {
                            return g_device_data.operator_name != "COMMON" && g_device_data.operator_name != "COMMON_INTL" 
                            && g_device_data.operator_name != "COMMON_EUR" && g_device_data.operator_name != "COMMON_NA" 
                            && g_device_data.operator_name != "SA_STC" && g_device_data.operator_name != "KEN_SARAFI" 
                            && g_device_data.operator_name != "PL_PLUS" && g_device_data.operator_name != "LEISHEN" 
                            && g_device_data.operator_name != "IDN_EMR" && g_device_data.operator_name != "IDN_SURGE" 
                            && g_device_data.user == "3" && !g_device_data.childMode;
                        }
                    }
                },
                {
                    path: '/management/pinManagement',
                    component:getRoute('content/pages/pinManagement'),
                    meta: {
                        title: 'pinManagement',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  (g_wanInterface.indexOf('5G') > -1 || g_device_data.SwitchAuto)  && g_device_data.operator_name == "PL_PLUS" && !g_device_data.childMode;
                        }
                    }
                },
                {
                    path: '/management/help',
                    component:getRoute('content/pages/help'),
                    meta: {
                        title: 'help',
                        icon: 'el-icon-upload',
                        show: function() {
                           return  true
                        }
                    }
                },
            ]    
        }
    ]

define(["exports"], function (exports) {
    var menu = meunDefault;
    for (var i=0; i<menu.length; i++)
    {
        var data = menu[i];
        if (data.meta && data.meta.show() == false){
            menu.splice(i, 1);
            i--;
            continue;
        }
        if (data.children && data.children.length)
        {
            for (var j=0; j<data.children.length; j++)
            {
                var data2 = data.children[j];
                if (data2.meta.show() == false) {
                    data.children.splice(j, 1);
                    j--;
                    continue;
                }
                if (data2.children && data2.children.length)
                {
                    for (var n=0; n<data2.children.length; n++)
                    {
                        var data3 = data2.children[n];
                        if (data3.meta.show() == false){
                            data2.children.splice(n, 1);
                            n--;
                        }
                    }
                }
            }
        }
    }
    exports.default = menu;
});