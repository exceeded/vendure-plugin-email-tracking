import { NgModule } from '@angular/core';
import { SharedModule, addNavMenuItem } from '@vendure/admin-ui/core';

/**
 * Registers the "Email Log" entry in the admin nav. Plugged into the
 * existing "Customers" section so account-handling staff find it where
 * they expect.
 */
@NgModule({
    imports: [SharedModule],
    providers: [
        addNavMenuItem(
            {
                id: 'hulo-email-log',
                label: 'Email Log',
                routerLink: ['/extensions/email-log'],
                icon: 'envelope',
                requiresPermission: 'ReadCustomer',
            },
            'customers',
        ),
    ],
})
export class EmailLogNavModule {}
