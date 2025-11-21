export type FormActionState<T, R = unknown> = {
  message: string;
  success?: boolean;
  data?: T;
  response?: R;
};

export type FormActionUpdateState<T, P> = {
  message: string;
  success?: boolean;
  changes?: T;
  pathParams: P;
};
