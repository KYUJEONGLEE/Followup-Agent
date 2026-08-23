import { Transform, type TransformFnParams } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  WRITE_APPROVAL_MODES,
  type WriteApprovalMode,
} from './write-approval';

export const AGENT_MESSAGE_MAX_LENGTH = 2000;

export class RunAgentRequestDto {
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(AGENT_MESSAGE_MAX_LENGTH)
  message!: string;

  @IsOptional()
  @IsIn(WRITE_APPROVAL_MODES)
  writeApprovalMode: WriteApprovalMode = 'required';
}
