import { Client, Connection } from "@temporalio/client";
import { config } from "../config.js";

let _client: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (_client) return _client;

  const connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
  _client = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
  return _client;
}
