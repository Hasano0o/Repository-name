/**
 * ZTE LTE Realistic Fixture — PHASE 5F
 *
 * Structure mimics publicly-documented ZTE CPE API responses.
 * All values are synthetic. Not real hardware data.
 *
 * NOTE: ZTE uses ?cmd=... query parameters. This fixture does not
 * do query matching (a documented limitation from PHASE 5C). It
 * returns the same JSON for any path match.
 */

import { MockRouterProfile } from '../types';
import { DISCLOSURE_UNIFORM } from './metadata';

const HOME_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <meta name="generator" content="ZTE WebUI">',
  '  <title>ZTE Router</title>',
  '</head>',
  '<body><div id="app"><h1>ZTE</h1></div></body>',
  '</html>',
].join('\n');

const GOForm_JSON = JSON.stringify({
  rsrp: '-91',
  rsrq: '-10',
  sinr: '18',
  rssi: '-65',
  pci: '123',
  band: '3',
  earfcn: '1650',
  lte_ca_pcell_band: '3',
  lte_ca_pcell_bandwidth: '20',
  lte_ca_pcell_freq: '1650',
  lte_multi_ca_scell_info: '3450,B7,20,456,-95,-12,0,15',
  wan_lte_ca: 'activated',
  wan_active_band: 'B3',
  wan_active_channel: '1650',
  cell_id: '0x0A1B2C3',
  network_type: 'LTE',
  network_provider: 'Synthetic ZTE Operator',
  network_provider_fullname: 'Synthetic ZTE Operator',
  signalbar: '4',
  modem_main_state: 'modem_init_complete',
  ppp_status: 'ppp_connected',
  wa_inner_version: 'ZTE_V1.0.0-synthetic',
  cr_version: 'CR_SYNTHETIC_V1',
  web_version: 'WEB_SYNTHETIC',
  hardware_version: 'MC801A-synthetic',
  realtime_rx_thrpt: '125000',
  realtime_tx_thrpt: '5000',
  realtime_time: '3600',
  monthly_rx_bytes: '1500000000',
  monthly_tx_bytes: '80000000',
});

const STATUS_JSON = JSON.stringify({
  modem_main_state: 'modem_init_complete',
  ppp_status: 'ppp_connected',
  network_provider: 'Synthetic ZTE Operator',
  network_type: 'LTE',
  signalbar: '4',
  wa_inner_version: 'ZTE_V1.0.0-synthetic',
});

export const ZTE_LTE_REALISTIC: MockRouterProfile = {
  id: 'zte-lte-realistic',
  vendor: 'ZTE',
  model: 'MC801A-synthetic',
  description: 'ZTE LTE CPE — realistic structure, synthetic values',
  realism: 'synthetic-realistic',
  disclosure: DISCLOSURE_UNIFORM,
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html; charset=utf-8', body: HOME_HTML },
  ],
  endpoints: [
    { method: 'GET', path: '/goform/goform_get_cmd_process', status: 200, contentType: 'application/json', body: GOForm_JSON },
    { method: 'GET', path: '/status.json', status: 200, contentType: 'application/json', body: STATUS_JSON },
  ],
};
