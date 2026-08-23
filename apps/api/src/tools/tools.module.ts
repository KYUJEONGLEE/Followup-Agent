import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { createGetConsultationsTool } from './read/get-consultations.tool';
import { createGetCustomerTool } from './read/get-customer.tool';
import { ConsultationRepository } from './repositories/consultation.repository';
import { CustomerRepository } from './repositories/customer.repository';
import { FollowUpTaskRepository } from './repositories/follow-up-task.repository';
import { ToolRegistry } from './tool-registry';
import { createFollowUpTaskTool } from './write/create-follow-up-task.tool';

@Module({
  imports: [DatabaseModule],
  providers: [
    CustomerRepository,
    ConsultationRepository,
    FollowUpTaskRepository,
    {
      provide: ToolRegistry,
      inject: [
        CustomerRepository,
        ConsultationRepository,
        FollowUpTaskRepository,
      ],
      useFactory: (
        customerRepository: CustomerRepository,
        consultationRepository: ConsultationRepository,
        followUpTaskRepository: FollowUpTaskRepository,
      ) =>
        new ToolRegistry([
          createGetCustomerTool(customerRepository),
          createGetConsultationsTool(consultationRepository),
          createFollowUpTaskTool(followUpTaskRepository),
        ]),
    },
  ],
  exports: [ToolRegistry],
})
export class ToolsModule {}
