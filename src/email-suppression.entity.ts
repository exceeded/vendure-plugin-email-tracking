import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/**
 * Per-recipient send suppression. When a row exists for an email address
 * the EmailTrackingService refuses to call SMTP on subsequent sends and
 * marks the would-be EmailLog row as `status='suppressed'`.
 *
 * Populated automatically from hard bounces and complaints; the admin
 * can also add / remove entries manually via the Email Log UI.
 */
@Entity()
export class EmailSuppression extends VendureEntity {
    constructor(input?: DeepPartial<EmailSuppression>) {
        super(input);
    }

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 320 })
    recipient!: string;

    /** Why this address is suppressed. */
    @Column({ type: 'varchar', length: 32 })
    reason!: 'hard-bounce' | 'complaint' | 'manual' | 'unsubscribe' | string;

    @Column({ type: 'text', nullable: true })
    note!: string;

    @Column({ type: 'int', nullable: true })
    channelId!: number;
}
