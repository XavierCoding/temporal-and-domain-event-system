export enum EventType {
  APP_LINK_SHARED      = "app_link_shared",
  APP_DOWNLOADED       = "app_downloaded",
  DOC_UPLOADED         = "doc_uploaded",
  DOC_REJECTED         = "doc_rejected",
  OB_DONE              = "ob_done",
  TC_ASSIGNED          = "tc_assigned",
  RESTART_JOURNEY      = "restart_journey",
  LOCATION_SHARED      = "location_shared",
  VACANCY_FOUND        = "vacancy_found",
  NO_VACANCY           = "no_vacancy",
  BLOCKER_UNRESOLVABLE = "blocker_unresolvable",
  STAGE_PROGRESSED     = "stage_progressed",
  DEMAND_NO_ORDERS     = "demand_no_orders",
  SI_FILED             = "si_filed",
  PAYMENT_DONE         = "payment_done",
  ACTIVATED            = "activated",
  FOD                  = "fod",
  GOT_BETTER_JOB       = "got_better_job",
  NO_SMARTPHONE        = "no_smartphone",
  NOT_INTERESTED       = "not_interested",
}

export interface DomainEvent {
  phone_number: string;
  event_type: EventType;
  client: string;
  data?: Record<string, unknown>;
  emitted_at: string;
}
