import { ToolDefinition } from '../models/assistant.models';

/**
 * Replace these with the real endpoints on your backend. Each tool becomes an
 * option the local LLM can choose to call after transcribing a voice command.
 * Keep descriptions short and unambiguous — the on-device model is small and
 * picks a tool by matching the command against these descriptions.
 */
export const BACKEND_BASE_URL = 'https://your-backend.example.com';

export const TOOLS: ToolDefinition[] = [
  {
    name: 'getCurrentDateTime',
    description: 'Get the current date and/or time. Use for any question about what day, date, or time it is right now.',
    params: [],
    localHandler: () => {
      const now = new Date();
      return {
        date: now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        time: now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      };
    }
  },
  {
    name: 'getOrderStatus',
    description: 'Get the delivery status of an order by its order ID.',
    params: [
      { name: 'orderId', type: 'string', description: 'The order ID, e.g. "12345"', required: true }
    ],
    method: 'GET',
    urlTemplate: '/api/orders/{orderId}/status'
  },
  {
    name: 'getAccountBalance',
    description: 'Get the current account balance for the signed-in user.',
    params: [],
    method: 'GET',
    urlTemplate: '/api/account/balance'
  }
];
