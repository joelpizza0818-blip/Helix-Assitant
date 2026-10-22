import chalk from 'chalk';
import type { AgentClient } from '../client/agent-client';
import { BOLD, CYAN, DIM, GREEN, GRAY, RED, YELLOW } from '../ui/colors';

export async function handleProviders(client: AgentClient): Promise<void> {
  try {
    const providers = await client.getProviders();
    console.log(`\n${BOLD('🧠 Proveedores configurados:')}\n`);
    for (const provider of providers) {
      const state = provider.configured ? GREEN('configurado') : GRAY('sin clave');
      console.log(`  ${CYAN(provider.name || provider.id)}  [${state}]  ${DIM(`${provider.models_available} modelos`)}`);
      for (const key of provider.keys || []) {
        console.log(`    ${DIM(`slot ${key.slot}:`)} ${key.configured ? GREEN(key.health) : GRAY('vacío')} ${key.masked || ''}`);
      }
    }
    console.log('');
  } catch (err) { console.log(RED(`  Error consultando proveedores: ${(err as Error).message}\n`)); }
}

export async function handleCapabilities(client: AgentClient): Promise<void> {
  try {
    const caps = await client.getCapabilities();
    console.log(`\n${BOLD('⚙ Capacidades activas:')}\n`);
    for (const [key, value] of Object.entries(caps)) {
      const rendered = typeof value === 'boolean' ? (value ? GREEN('activo') : YELLOW('inactivo')) : CYAN(String(value));
      console.log(`  ${DIM(key.padEnd(24))} ${rendered}`);
    }
    console.log('');
  } catch (err) { console.log(RED(`  Error consultando capacidades: ${(err as Error).message}\n`)); }
}

export async function handleSettings(client: AgentClient): Promise<void> {
  try {
    const settings = await client.getSettings();
    const safe = Object.fromEntries(Object.entries(settings).filter(([key]) => !/key|token|secret|password|auth/i.test(key)));
    console.log(`\n${BOLD('📋 Configuración efectiva (sin secretos):')}\n${JSON.stringify(safe, null, 2)}\n`);
  } catch (err) { console.log(RED(`  Error consultando configuración: ${(err as Error).message}\n`)); }
}
