#!/usr/bin/env bun
/**
 * Fleet TUI - Interactive terminal interface
 * Usage: bun tui.ts
 */

import { Database } from "bun:sqlite";

const FLEET = [
  { name: "crimson", url: "https://crimson-ca3e-vers.ngrok.io", trit: -1, ram: 1024, cpu: 2 },
  { name: "indigo", url: "https://indigo-97b2-vers.ngrok.io", trit: 0, ram: 1024, cpu: 2 },
  { name: "azure", url: "https://azure-186f-vers.ngrok.io", trit: 1, ram: 1024, cpu: 2 }
] as const;

type VM = typeof FLEET[number];

class SessionRouter {
  private db: Database;
  
  constructor() {
    this.db = new Database(':memory:');
    this.db.run('CREATE TABLE sessions (user TEXT PRIMARY KEY, vm TEXT, used INTEGER)');
  }
  
  assign(user: string, vm: VM) {
    this.db.run('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)', [user, vm.name, Date.now()]);
  }
  
  get(user: string): VM | null {
    const row = this.db.query('SELECT vm FROM sessions WHERE user = ?').get(user) as {vm: string} | null;
    if (!row) return null;
    const found = FLEET.find(v => v.name === row.vm);
    return found ?? null;
  }
}

class TUI {
  private router = new SessionRouter();
  private vm: VM | null = null;
  private fleetStatus = { online: 0, total: 3, lastUsed: Date.now() };
  
  async start() {
    console.clear();
    
    // Check health
    console.log('Checking fleet...');
    const online = await this.getOnline();
    
    if (online.length === 0) {
      console.log('❌ No VMs online');
      process.exit(1);
    }
    
    this.fleetStatus.online = online.length;
    this.fleetStatus.lastUsed = Date.now();
    
    // Assign VM
    const user = process.env.USER || 'user';
    this.vm = this.router.get(user) ?? online[0] ?? null;
    if (this.vm) {
      this.router.assign(user, this.vm);
    }
    
    this.drawScreen();
    await this.repl();
  }
  
  drawScreen() {
    console.clear();
    this.drawStatusBar();
    console.log();
    console.log('/status /switch /health /quit');
    console.log();
  }
  
  drawStatusBar() {
    // Full domain
    const domain = this.vm!.url.replace('https://', '');
    
    // Calculate total resources
    const totalRam = FLEET.reduce((sum, vm) => sum + vm.ram, 0);
    const totalCpu = FLEET.reduce((sum, vm) => sum + vm.cpu, 0);
    const ramDisplay = this.formatMemory(totalRam);
    
    const fleet = `${this.fleetStatus.online}/${this.fleetStatus.total}`;
    
    const line1 = domain;
    const line2 = `Fleet: ${fleet} • RAM: ${ramDisplay} • CPU: ${totalCpu} vCPU`;
    
    console.log('┌─' + '─'.repeat(line1.length) + '─┐');
    console.log(`│ ${line1} │`);
    console.log(`│ ${line2} │`);
    console.log('└─' + '─'.repeat(line1.length) + '─┘');
  }
  
  formatMemory(mib: number): string {
    if (mib >= 1024) {
      return `${(mib / 1024).toFixed(1)}GiB`;
    }
    return `${mib}MiB`;
  }
  
  centerPad(text: string, width: number): string {
    const clean = text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    const padding = width - clean.length;
    const left = Math.floor(padding / 2);
    return ' '.repeat(left) + text;
  }
  
  padRight(text: string, width: number): string {
    const clean = text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    return text + ' '.repeat(Math.max(0, width - clean.length));
  }
  
  role(trit: number): string {
    return trit === -1 ? 'MINUS (Verify)' : trit === 0 ? 'ERGODIC (Coord)' : 'PLUS (Generate)';
  }
  
  async getOnline(): Promise<VM[]> {
    const checks = await Promise.all(
      FLEET.map(async vm => {
        try {
          const res = await fetch(`${vm.url}/health`, { signal: AbortSignal.timeout(3000) });
          return res.ok ? vm : null;
        } catch { return null; }
      })
    );
    return checks.filter(v => v !== null) as VM[];
  }
  
  async repl() {
    const stdin = Bun.stdin.stream();
    const reader = stdin.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    const prompt = () => process.stdout.write(`[${this.vm!.name}]> `);
    prompt();
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const input = line.trim();
        if (!input) { prompt(); continue; }
        
        if (input.startsWith('/')) {
          if (input === '/quit' || input === '/exit') {
            console.log('\nGoodbye!');
            process.exit(0);
          }
          else if (input === '/status') await this.status();
          else if (input === '/switch') await this.switch();
          else if (input === '/health') await this.health();
          else console.log(`Unknown: ${input}`);
        } else {
          console.log(`\n→ ${this.vm!.name}: "${input}"`);
          console.log(`← (ACP response would appear here)\n`);
        }
        
        // Update status bar on every interaction
        await this.updateStatus();
        prompt();
      }
    }
  }
  
  async updateStatus() {
    const online = await this.getOnline();
    this.fleetStatus.online = online.length;
  }
  
  async status() {
    console.log('\nFleet Status:\n');
    const checks = await Promise.all(
      FLEET.map(async vm => {
        const start = Date.now();
        try {
          const res = await fetch(`${vm.url}/health`, { signal: AbortSignal.timeout(3000) });
          const data = await res.json();
          return { vm, ok: true, ms: Date.now() - start };
        } catch {
          return { vm, ok: false, ms: 0 };
        }
      })
    );
    
    checks.forEach(c => {
      const icon = c.ok ? '✅' : '❌';
      const cur = c.vm.name === this.vm!.name ? ' ← you' : '';
      const ms = c.ok ? `${c.ms}ms` : 'timeout';
      const domain = c.vm.url.replace('https://', '');
      console.log(`${icon} ${domain}: ${ms}${cur}`);
    });
    console.log();
  }
  
  async switch() {
    const online = await this.getOnline();
    const next = online.find(v => v.name !== this.vm?.name) ?? online[0];
    if (!next) {
      console.log('No VMs available\n');
      return;
    }
    this.vm = next;
    this.router.assign(process.env.USER || 'user', next);
    await this.updateStatus();
    this.drawScreen();
    console.log(`✅ Switched to ${next.name} (trit ${next.trit})\n`);
  }
  
  async health() {
    console.log('\nHealth Check:\n');
    for (const vm of FLEET) {
      process.stdout.write(`${vm.name}... `);
      const start = Date.now();
      try {
        await fetch(`${vm.url}/health`, { signal: AbortSignal.timeout(5000) });
        console.log(`✅ ${Date.now() - start}ms`);
      } catch {
        console.log('❌ timeout');
      }
    }
    console.log();
  }
}

new TUI().start();
