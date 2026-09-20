import { RouterDriver, Capability } from '../types';

export class MikrotikDriver implements RouterDriver {
  id = 'mikrotik';
  name = 'MikroTik';
  capabilities: Capability[] = [];
  async detect(host: string) { return false; }
  async login(host: string, username: string, password: string) {}
  async logout() {}
}
