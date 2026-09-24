import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';

export function useCompany() {
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      try {
        const user = await base44.auth.me();
        if (!user.company_id) {
          navigate('/criar-restaurante');
          return;
        }
        const c = await base44.entities.Company.get(user.company_id);
        setCompany(c);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return { loading, company, setCompany };
}