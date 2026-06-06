import { useState, useEffect } from "react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export function useCommissionRate(): number {
  const [rate, setRate] = useState(0.15);
  useEffect(() => {
    fetch(`${BASE_URL}/api/rides/pricing-info`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.commission?.percent != null) setRate(d.commission.percent / 100);
      })
      .catch(() => {});
  }, []);
  return rate;
}
