-- Optional goals belong to fixed Europe/Athens calendar periods in this single-user app.
-- Exact integer seconds: one hundredth hour = 36 seconds.
CREATE TABLE public.reading_goals (
  type text NOT NULL CHECK (type IN ('weekly', 'yearly')),
  period_start date NOT NULL CHECK (period_start >= DATE '1000-01-01' AND period_start < DATE '9999-01-01'),
  target_seconds bigint NOT NULL CHECK (target_seconds > 0 AND target_seconds <= 9007199254740991 AND target_seconds % 36 = 0),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (type, period_start),
  CHECK ((type = 'weekly' AND extract(isodow FROM period_start) = 1)
    OR (type = 'yearly' AND extract(month FROM period_start) = 1 AND extract(day FROM period_start) = 1))
);
ALTER TABLE public.reading_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reading_goals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_goals TO service_role;
CREATE TRIGGER reading_goals_updated_at BEFORE UPDATE ON public.reading_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
COMMENT ON TABLE public.reading_goals IS 'Private single-user goals; fixed Europe/Athens calendar periods, no carry-forward. Service-role server access only.';
