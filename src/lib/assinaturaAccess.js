import { getMyResellerClientAccess } from '../api/resellerClients.js';

export async function loadManagedResellerAccess(client) {
  return getMyResellerClientAccess(client);
}
