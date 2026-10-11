import { NgModule } from '@angular/core';
import { SharedModule, addNavMenuItem, registerDashboardWidget } from '@vendure/admin-ui/core';

/**
 * Registers the "Email Log" entry in the admin nav (plugged into the
 * existing "Customers" section so account-handling staff find it where
 * they expect) and the "Email Tracking" dashboard widget
 * (Dashboard → Add widget → Email Tracking).
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
        registerDashboardWidget('hulo-vendure-plugin-email-tracking', {
            title: 'Email Tracking',
            supportedWidths: [4, 6, 8],
            requiresPermissions: ['ReadCustomer'],
            loadComponent: () => import('./components/email-tracking-widget.component').then(m => m.EmailTrackingWidgetComponent),
        }),
    ],
})
export class EmailLogNavModule {}
