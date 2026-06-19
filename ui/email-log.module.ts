import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SharedModule } from '@vendure/admin-ui/core';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { EmailLogComponent } from './components/email-log.component';

@NgModule({
    imports: [
        SharedModule, FormsModule, HttpClientModule,
        RouterModule.forChild([
            { path: '', pathMatch: 'full', component: EmailLogComponent, data: { breadcrumb: 'Email Log' } },
        ]),
    ],
    declarations: [EmailLogComponent],
})
export class EmailLogModule {}
