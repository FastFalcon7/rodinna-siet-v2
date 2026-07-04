import { z } from 'zod';
import { NotificationPayloadSchema } from '@rodinna/shared-types';
import { sendPushToUsers } from './push';

/** Payload jobu 'push.send' (enqueuje notifyUsers v service.ts). */
const PushSendJobSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
  notification: NotificationPayloadSchema,
});

/** Registrácia job handlerov modulu do worker procesu (volá worker/index.ts). */
export function registerNotificationJobs(
  register: (kind: string, handler: (payload: unknown) => Promise<void>) => void,
): void {
  register('push.send', async (payload) => {
    const job = PushSendJobSchema.parse(payload);
    await sendPushToUsers(job.userIds, job.notification);
  });
}
