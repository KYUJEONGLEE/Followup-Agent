export interface ToolSuccessResult<TData> {
  status: 'success';
  data: TData;
}

export interface ToolNotFoundResult {
  status: 'not_found';
  data: null;
  message: string;
}

export type ToolResult<TData> =
  | ToolSuccessResult<TData>
  | ToolNotFoundResult;

export function toolSuccess<TData>(data: TData): ToolSuccessResult<TData> {
  return { status: 'success', data };
}

export function toolNotFound(message: string): ToolNotFoundResult {
  return { status: 'not_found', data: null, message };
}
