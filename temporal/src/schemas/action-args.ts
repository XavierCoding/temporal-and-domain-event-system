export interface ActionArgs {
  phone: string;
  client?: string;
  template?: string;
  replacements?: string[];
  nextNode?: string;
  eventData?: Record<string, unknown>;
  paused?: boolean;
  temperature?: "hot" | "warm" | "cold";
  elapsedHours?: number;
  city?: string;
  jobType?: string;
  stage?: string;
}
