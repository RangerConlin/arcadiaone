import type { NotificationChannel } from "@/generated/prisma/enums";

/**
 * Delivery channel abstraction. The in-app channel *is* the Notification row, so it needs
 * no extra work at dispatch time. Email is a declared extension point: no provider is
 * configured, `isEnabled()` is false, and nothing claims to be sent. SMS is intentionally
 * not implemented.
 */
export type OutboundMessage = { to: string; subject: string; text: string };

/** Vendor-neutral mail transport. A future SMTP/API adapter implements this and nothing else changes. */
export interface Mailer {
  send(message: OutboundMessage): Promise<void>;
}

export interface DeliveryChannel {
  readonly id: NotificationChannel;
  isEnabled(): boolean;
}

export const inAppChannel: DeliveryChannel = { id: "IN_APP", isEnabled: () => true };

let configuredMailer: Mailer | null = null;
/** Called once at startup by a future email integration. */
export function registerMailer(mailer: Mailer | null) {
  configuredMailer = mailer;
}
export const emailChannel: DeliveryChannel = { id: "EMAIL", isEnabled: () => configuredMailer !== null };

export const DELIVERY_CHANNELS: readonly DeliveryChannel[] = [inAppChannel, emailChannel];
/** Channels users can currently switch on. Only in-app is real today. */
export const availableChannels = () => DELIVERY_CHANNELS.filter((channel) => channel.isEnabled()).map((channel) => channel.id);
