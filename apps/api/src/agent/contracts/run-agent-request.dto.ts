import { Transform, type TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const AGENT_MESSAGE_MAX_LENGTH = 2000;

export class RunAgentRequestDto {
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(AGENT_MESSAGE_MAX_LENGTH)
  message!: string;
}
