import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { createGetConsultationsTool } from './read/get-consultations.tool';
import { createGetCustomerTool } from './read/get-customer.tool';
import { ConsultationRepository } from './repositories/consultation.repository';
import { CustomerRepository } from './repositories/customer.repository';
import { ToolRegistry } from './tool-registry';

@Module({
  imports: [DatabaseModule],
  providers: [
    CustomerRepository,
    ConsultationRepository,
    {
      provide: ToolRegistry,
      inject: [CustomerRepository, ConsultationRepository],
      useFactory: (
        customerRepository: CustomerRepository,
        consultationRepository: ConsultationRepository,
      ) =>
        new ToolRegistry([
          createGetCustomerTool(customerRepository),
          createGetConsultationsTool(consultationRepository),
        ]),
    },
  ],
  exports: [ToolRegistry],
})
export class ToolsModule {}
