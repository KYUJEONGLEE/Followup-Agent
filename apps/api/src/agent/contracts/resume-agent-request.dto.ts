import { IsIn, IsUUID } from 'class-validator';
import {
  APPROVAL_DECISIONS,
  type ApprovalDecision,
} from './write-approval';

export class ResumeAgentRequestDto {
  @IsUUID('4')
  approvalId!: string;

  @IsIn(APPROVAL_DECISIONS)
  decision!: ApprovalDecision;
}
