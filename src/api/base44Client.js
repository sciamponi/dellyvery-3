import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

//Create a client with authentication required
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl,
  // Telemetria do editor Base44 desligada no deploy standalone (sem ela, o
  // SDK chama /api inexistente e quebra o render fora do editor).
  analytics: { enabled: false },
});
