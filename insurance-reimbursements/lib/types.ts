export type ClaimRoute = "both" | "complementary_only";

export type ClaimStatus =
  | "needs_isapre"
  | "waiting_isapre"
  | "needs_complementary"
  | "waiting_complementary"
  | "correction_isapre"
  | "correction_complementary"
  | "closed";

export type Claim = {
  name: string;
  route: ClaimRoute;
  status: ClaimStatus;
  createdAt: string;
  expenseDate: string;
  isapreSubmittedAt: string;
  complementarySubmittedAt: string;
  updatedAt: string;
};

export type ClaimAction =
  | "submit_isapre"
  | "isapre_reimbursement_received"
  | "submit_complementary"
  | "request_isapre_correction"
  | "request_complementary_correction"
  | "resubmit_isapre"
  | "resubmit_complementary"
  | "close";
