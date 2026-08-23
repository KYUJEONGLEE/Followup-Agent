import { IsIn } from 'class-validator';
import {
  APPROVAL_DECISIONS,
  type ApprovalDecision,
} from './write-approval';

export class ResumeAgentRequestDto {
  @IsIn(APPROVAL_DECISIONS)
  decision!: ApprovalDecision;
}
