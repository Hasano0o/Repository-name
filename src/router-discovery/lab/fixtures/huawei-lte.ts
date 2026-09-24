/**
 * Huawei LTE Realistic Fixture — PHASE 5F
 *
 * Structure mimics publicly-documented Huawei CPE API responses.
 * All values are synthetic. Not real hardware data.
 * Not an assertion of device support.
 */

import { MockRouterProfile } from '../types';
import { DISCLOSURE_UNIFORM } from './metadata';

const HOME_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '  <meta name="generator" content="Huawei WebUI">',
  '  <title>Huawei LTE Router</title>',
  '  <link rel="stylesheet" href="/css/main.css">',
  '  <script src="/js/app.js"></script>',
  '</head>',
  '<body>',
  '  <div id="app">',
  '    <header><h1>Huawei Router</h1></header>',
  '    <nav><a href="/html/home.html">Home</a> <a href="/html/status.html">Status</a></nav>',
  '    <main><p>Loading...</p></main>',
  '  </div>',
  '</body>',
  '</html>',
].join('\n');

const HOME_INNER_HTML = HOME_HTML.replace('Loading...', 'Welcome');

const STATUS_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <meta name="generator" content="Huawei WebUI">',
  '  <title>Status - Huawei Router</title>',
  '</head>',
  '<body>',
  '  <div id="status">',
  '    <div class="signal">RSRP: -- dBm</div>',
  '    <div class="signal">SINR: -- dB</div>',
  '  </div>',
  '</body>',
  '</html>',
].join('\n');

const INFO_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <DeviceName>Synthetic Huawei CPE</DeviceName>',
  '  <SoftwareVersion>2.0.0-synthetic</SoftwareVersion>',
  '  <HardwareVersion>B535-synthetic</HardwareVersion>',
  '  <Imei>490154203237518</Imei>',
  '  <MacAddress>AA:BB:CC:DD:EE:FF</MacAddress>',
  '  <WanIPAddress>192.168.8.100</WanIPAddress>',
  '</response>',
].join('\n');

const SIGNAL_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <rsrp>-91</rsrp>',
  '  <rsrq>-10</rsrq>',
  '  <rssi>-65</rssi>',
  '  <sinr>18</sinr>',
  '  <pci>123</pci>',
  '  <cell_id>0x0A1B2C3</cell_id>',
  '  <earfcn>1650</earfcn>',
  '  <band>3</band>',
  '  <dlbandwidth>20</dlbandwidth>',
  '  <ulbandwidth>10</ulbandwidth>',
  '  <cqi0>12</cqi0>',
  '  <dl_mcs>mcsDownCarrier1Code0:18 mcsDownCarrier1Code1:20</dl_mcs>',
  '  <ul_mcs>mcsUpCarrier1:15</ul_mcs>',
  '  <txpower>PPusch:10dBm PPucch:1dBm</txpower>',
  '  <enodeb_id>112233</enodeb_id>',
  '</response>',
].join('\n');

const STATUS_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <ConnectionStatus>901</ConnectionStatus>',
  '  <CurrentNetworkType>19</CurrentNetworkType>',
  '  <CurrentNetworkTypeEx>101</CurrentNetworkTypeEx>',
  '  <SignalIcon>4</SignalIcon>',
  '  <SignalIconNr>0</SignalIconNr>',
  '  <WanIPAddress>192.168.8.100</WanIPAddress>',
  '  <PrimaryDns>1.1.1.1</PrimaryDns>',
  '  <SecondaryDns>1.0.0.1</SecondaryDns>',
  '  <SimStatus>1</SimStatus>',
  '</response>',
].join('\n');

const TRAFFIC_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <CurrentDownloadRate>125000</CurrentDownloadRate>',
  '  <CurrentUploadRate>5000</CurrentUploadRate>',
  '  <CurrentConnectTime>3600</CurrentConnectTime>',
  '  <TotalDownload>1500000000</TotalDownload>',
  '  <TotalUpload>80000000</TotalUpload>',
  '</response>',
].join('\n');

const MONTH_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <CurrentMonthDownload>1500000000</CurrentMonthDownload>',
  '  <CurrentMonthUpload>80000000</CurrentMonthUpload>',
  '  <MonthDuration>7200</MonthDuration>',
  '</response>',
].join('\n');

const START_DATE_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <StartDay>1</StartDay>',
  '  <DataLimit>100GB</DataLimit>',
  '  <MonthThreshold>90</MonthThreshold>',
  '</response>',
].join('\n');

const PLMN_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <State>0</State>',
  '  <FullName>Synthetic Operator</FullName>',
  '  <ShortName>SYN</ShortName>',
  '  <Numeric>310150</Numeric>',
  '</response>',
].join('\n');

const NET_MODE_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <NetworkMode>00</NetworkMode>',
  '  <NetworkBand>3FFFFFFF</NetworkBand>',
  '  <LTEBand>7FFFFFFFFFFFFFFF</LTEBand>',
  '  <LTEBandOption>0</LTEBandOption>',
  '</response>',
].join('\n');

const NET_MODE_LIST_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <AccessList>',
  '    <Access><Value>00</Value><Label>Auto</Label></Access>',
  '    <Access><Value>03</Value><Label>LTE</Label></Access>',
  '  </AccessList>',
  '  <LTEBandList>',
  '    <LTEBand><Value>0x180080800c5</Value></LTEBand>',
  '  </LTEBandList>',
  '</response>',
].join('\n');

const LOCK_FREQ_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <lte_info><lock_mode>0</lock_mode><all_bands></all_bands></lte_info>',
  '  <nr_info><lock_mode>0</lock_mode><all_bands></all_bands></nr_info>',
  '</response>',
].join('\n');

const HOST_LIST_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <Hosts>',
  '    <Host>',
  '      <MacAddress>11:22:33:44:55:66</MacAddress>',
  '      <IpAddress>192.168.8.101</IpAddress>',
  '      <HostName>synthetic-device-1</HostName>',
  '    </Host>',
  '  </Hosts>',
  '</response>',
].join('\n');

const SECCELL_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <lteseccell_list>1650,B3,20,123,-89,-10,0,19;3450,B7,20,456,-95,-12,0,15</lteseccell_list>',
  '  <nrseccell_list></nrseccell_list>',
  '</response>',
].join('\n');

const NBRCELL_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <nbrcell_list>1650,132,-95,-9,-80,12;3450,456,-99,-12,-85,10</nbrcell_list>',
  '</response>',
].join('\n');

export const HUAWEI_LTE_REALISTIC: MockRouterProfile = {
  id: 'huawei-lte-realistic',
  vendor: 'Huawei',
  model: 'B535-synthetic',
  description: 'Huawei LTE CPE — realistic structure, synthetic values',
  realism: 'synthetic-realistic',
  disclosure: DISCLOSURE_UNIFORM,
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html; charset=utf-8', body: HOME_HTML },
    { method: 'GET', path: '/html/home.html', status: 200, contentType: 'text/html; charset=utf-8', body: HOME_INNER_HTML },
    { method: 'GET', path: '/html/status.html', status: 200, contentType: 'text/html; charset=utf-8', body: STATUS_HTML },
  ],
  endpoints: [
    { method: 'GET', path: '/api/device/information', status: 200, contentType: 'application/xml', body: INFO_XML },
    { method: 'GET', path: '/api/device/signal', status: 200, contentType: 'application/xml', body: SIGNAL_XML },
    { method: 'GET', path: '/api/device/seccellinfo', status: 200, contentType: 'application/xml', body: SECCELL_XML },
    { method: 'GET', path: '/api/device/nbrcellinfo', status: 200, contentType: 'application/xml', body: NBRCELL_XML },
    { method: 'GET', path: '/api/monitoring/status', status: 200, contentType: 'application/xml', body: STATUS_XML },
    { method: 'GET', path: '/api/monitoring/traffic-statistics', status: 200, contentType: 'application/xml', body: TRAFFIC_XML },
    { method: 'GET', path: '/api/monitoring/month_statistics', status: 200, contentType: 'application/xml', body: MONTH_XML },
    { method: 'GET', path: '/api/monitoring/start_date', status: 200, contentType: 'application/xml', body: START_DATE_XML },
    { method: 'GET', path: '/api/net/current-plmn', status: 200, contentType: 'application/xml', body: PLMN_XML },
    { method: 'GET', path: '/api/net/net-mode', status: 200, contentType: 'application/xml', body: NET_MODE_XML },
    { method: 'GET', path: '/api/net/net-mode-list', status: 200, contentType: 'application/xml', body: NET_MODE_LIST_XML },
    { method: 'GET', path: '/api/net/lock-freq', status: 200, contentType: 'application/xml', body: LOCK_FREQ_XML },
    { method: 'GET', path: '/api/wlan/host-list', status: 200, contentType: 'application/xml', body: HOST_LIST_XML },
  ],
};
