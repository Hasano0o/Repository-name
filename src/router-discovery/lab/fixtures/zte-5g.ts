/**
 * ZTE 5G NSA Realistic Fixture — PHASE 5F
 *
 * Structure mimics publicly-documented ZTE 5G CPE API responses.
 * All values are synthetic. Not real hardware data.
 */

import { MockRouterProfile } from '../types';
import { DISCLOSURE_UNIFORM } from './metadata';

const HOME_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <meta name="generator" content="ZTE WebUI">',
  '  <title>ZTE 5G Router</title>',
  '</head>',
  '<body><div id="app"><h1>ZTE 5G</h1></div></body>',
  '</html>',
].join('\n');

const GOForm_JSON = JSON.stringify({
  lte_rsrp: '-88',
  lte_rsrq: '-9',
  lte_snr: '20',
  lte_pci: '456',
  lte_band: '3',
  lte_earfcn: '1300',
  nr5g_pci: '789',
  nr5g_action_band: '78',
  nr5g_action_channel: '640000',
  nr5g_rsrp: '-84',
  nr5g_rsrq: '-11',
  nr5g_sinr: '24',
  nr5g_dlbandwidth: '100',
  nr5g_cell_id: '0x11AA22B',
  network_type: '5G_NSA',
  network_provider: 'Synthetic 5G Operator',
  signalbar: '5',
  modem_main_state: 'modem_init_complete',
  ppp_status: 'ppp_connected',
  wa_inner_version: 'ZTE_V2.0.0-synthetic',
  cr_version: 'CR_SYNTHETIC_V2',
  hardware_version: 'MC888-synthetic',
  realtime_rx_thrpt: '250000',
  realtime_tx_thrpt: '10000',
});

const STATUS_TEXT = [
  'modem_main_state=modem_init_complete',
  'ppp_status=ppp_connected',
  'network_provider=Synthetic 5G Operator',
  'network_type=5G_NSA',
  'signalbar=5',
].join('\n');

export const ZTE_5G_REALISTIC: MockRouterProfile = {
  id: 'zte-5g-realistic',
  vendor: 'ZTE',
  model: 'MC888-synthetic',
  description: 'ZTE 5G NSA CPE — realistic structure, synthetic values',
  realism: 'synthetic-realistic',
  disclosure: DISCLOSURE_UNIFORM,
  pages: [
    { method: 'GET', path: '/', status: 200, contentType: 'text/html; charset=utf-8', body: HOME_HTML },
  ],
  endpoints: [
    { method: 'GET', path: '/goform/goform_get_cmd_process', status: 200, contentType: 'application/json', body: GOForm_JSON },
    { method: 'GET', path: '/device/status', status: 200, contentType: 'text/plain; charset=utf-8', body: STATUS_TEXT },
  ],
};
