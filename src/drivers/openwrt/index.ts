import { RouterDriver, Capability } from '../types';

export class OpenWrtDriver implements RouterDriver {
  id = 'openwrt';
  name = 'OpenWrt';
  capabilities: Capability[] = [];
  async detect(host: string) { return false; }
  async login(host: string, username: string, password: string) {}
  async logout() {}
}
