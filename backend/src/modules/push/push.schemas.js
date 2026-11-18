const { z } = require('zod');

const subscribeSchema = z.object({
  endpoint: z.string().min(1, 'endpoint is required'),
  keys: z.object({
    p256dh: z.string().min(1, 'keys.p256dh is required'),
    auth: z.string().min(1, 'keys.auth is required'),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().min(1, 'endpoint is required'),
});

module.exports = { subscribeSchema, unsubscribeSchema };
