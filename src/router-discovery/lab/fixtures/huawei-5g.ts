/**
 * Huawei 5G NSA Realistic Fixture — PHASE 5F
 *
 * Structure mimics publicly-documented Huawei 5G CPE API responses.
 * All values are synthetic. Not real hardware data.
 */

import { MockRouterProfile } from '../types';
import { DISCLOSURE_UNIFORM } from './metadata';

const HOME_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <meta name="generator" content="Huawei WebUI">',
  '  <title>Huawei 5G CPE</title>',
  '</head>',
  '<body><div id="app"><header><h1>5G CPE Pro</h1></header></div></body>',
  '</html>',
].join('\n');

const INFO_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <DeviceName>Synthetic 5G CPE</DeviceName>',
  '  <SoftwareVersion>3.0.0-synthetic</SoftwareVersion>',
  '  <HardwareVersion>5G-CPE-Pro-synthetic</HardwareVersion>',
  '  <Imei>490154203237518</Imei>',
  '  <MacAddress>AA:BB:CC:DD:EE:FF</MacAddress>',
  '  <WanIPAddress>192.168.8.100</WanIPAddress>',
  '</response>',
].join('\n');

const SIGNAL_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <rsrp>-88</rsrp>',
  '  <rsrq>-9</rsrq>',
  '  <rssi>-62</rssi>',
  '  <sinr>20</sinr>',
  '  <pci>456</pci>',
  '  <cell_id>0x1B2C3D4</cell_id>',
  '  <earfcn>1300</earfcn>',
  '  <band>3</band>',
  '  <dlbandwidth>20</dlbandwidth>',
  '  <ulbandwidth>10</ulbandwidth>',
  '  <nr5g_rsrp>-85</nr5g_rsrp>',
  '  <nr5g_rsrq>-11</nr5g_rsrq>',
  '  <nr5g_sinr>22</nr5g_sinr>',
  '  <nr5g_pci>789</nr5g_pci>',
  '  <nrarfcn>640000</nrarfcn>',
  '  <nrband>78</nrband>',
  '  <nrdlbandwidth>100</nrdlbandwidth>',
  '  <nrcqi0>13</nrcqi0>',
  '  <nrdlmcs>mcsDownCarrier1Code0:22 mcsDownCarrier1Code1:24</nrdlmcs>',
  '  <nrtxpower>PPusch:8dBm</nrtxpower>',
  '  <nrrank>2</nrrank>',
  '</response>',
].join('\n');

const STATUS_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <ConnectionStatus>901</ConnectionStatus>',
  '  <CurrentNetworkType>19</CurrentNetworkType>',
  '  <CurrentNetworkTypeEx>111</CurrentNetworkTypeEx>',
  '  <CurrentNrNetworkType>2</CurrentNrNetworkType>',
  '  <SignalIcon>4</SignalIcon>',
  '  <SignalIconNr>5</SignalIconNr>',
  '  <WanIPAddress>192.168.8.100</WanIPAddress>',
  '  <SimStatus>1</SimStatus>',
  '</response>',
].join('\n');

const TRAFFIC_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <CurrentDownloadRate>250000</CurrentDownloadRate>',
  '  <CurrentUploadRate>10000</CurrentUploadRate>',
  '  <CurrentConnectTime>7200</CurrentConnectTime>',
  '</response>',
].join('\n');

const MONTH_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <CurrentMonthDownload>3000000000</CurrentMonthDownload>',
  '  <CurrentMonthUpload>150000000</CurrentMonthUpload>',
  '</response>',
].join('\n');

const START_DATE_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response><StartDay>1</StartDay><DataLimit>200GB</DataLimit><MonthThreshold>90</MonthThreshold></response>',
].join('\n');

const PLMN_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response><State>0</State><FullName>Synthetic 5G Operator</FullName><ShortName>SYN5</ShortName><Numeric>310150</Numeric></response>',
].join('\n');

const NET_MODE_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response><NetworkMode>00</NetworkMode><NetworkBand>3FFFFFFF</NetworkBand><LTEBand>7FFFFFFFFFFFFFFF</LTEBand><LTEBandOption>0</LTEBandOption></response>',
].join('\n');

const NET_MODE_LIST_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <AccessList>',
  '    <Access><Value>00</Value><Label>Auto</Label></Access>',
  '    <Access><Value>08</Value><Label>5G</Label></Access>',
  '  </AccessList>',
  '  <LTEBandList><LTEBand><Value>0x180080800c5</Value></LTEBand></LTEBandList>',
  '</response>',
].join('\n');

const LOCK_FREQ_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response><lte_info><lock_mode>0</lock_mode><all_bands></all_bands></lte_info><nr_info><lock_mode>0</lock_mode><all_bands></all_bands></nr_info></response>',
].join('\n');

const HOST_LIST_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response><Hosts><Host><MacAddress>11:22:33:44:55:66</MacAddress><IpAddress>192.168.8.101</IpAddress><HostName>synthetic-5g-device</HostName></Host></Hosts></response>',
].join('\n');

const SECCELL_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response>',
  '  <lteseccell_list>1300,B3,20,456,-89,-10,0,19;3450,B7,20,789,-93,-12,0,16</lteseccell_list>',
  '  <nrseccell_list>640000,n78,100,789,-85,-11,0,22</nrseccell_list>',
  '</response>',
].join('\n');

const NBRCELL_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<response><nbrcell_list>1300,456,-93,-9,-80,14;3450,789,-97,-12,-85,11</nbrcell_list></response>',
].join('\n');

export const HUAWEI_5G_REALISTIC: MockRouterProfile = {
  id: 'huawei-5g-realistic',
  vendor: 'Huawei',
  model: '5G-CPE-Pro-synthetic',
  description: 'Huawei 5G NSA CPE — realistic structure, synthetic values',
  realism: 'synthetic-realistic',
  disclosure: DISCLOSURE_UNIFORM,
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html; charset=utf-8', body: HOME_HTML },
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
