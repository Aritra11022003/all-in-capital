-- Reference data only (no applicant data). Users are created by invitation in the Supabase dashboard,
-- then given a profile row here, e.g.:
--   insert into profiles (id, full_name, role) values ('<auth user uuid>', 'Kushal Bhagia', 'kushal');

insert into portfolio_datasets (version, verified, note) values
  ('portfolio-v1', false, 'Built from the 6 invested deal memos and partner meeting notes (MeetRecord). Known to be incomplete.')
on conflict do nothing;

insert into portfolio_companies (dataset_version, name, sector, description, category_terms, customer_terms, channel_terms, source) values
  ('portfolio-v1','The ePlane Company','Deeptech (aerial mobility)','eVTOL aircraft and UAVs', array['evtol','aircraft','uav','drone','aerial'], array['commuters'], '{}', 'Deal Memo 1'),
  ('portfolio-v1','Unbox Robotics','Deeptech (warehouse robotics)','Robotic package sorting', array['robotics','sorting','warehouse automation'], array['warehouse','logistics companies'], '{}', 'Deal Memo 3'),
  ('portfolio-v1','Wint Wealth','Fintech (bonds)','Retail access to bonds', array['bonds','fixed income','wealth'], array['retail investors'], '{}', 'Deal Memo 5'),
  ('portfolio-v1','Giva','Consumer brand (jewellery)','Online-first silver jewellery', array['jewellery','silver','gold'], array['gifting'], array['marketplaces'], 'Deal Memo 7'),
  ('portfolio-v1','SuperK','Consumer tech (small-town retail)','Small-town grocery retail network', array['kirana','grocery retail','small-town retail','restocking'], array['store owners','small towns'], array['distributors'], 'Deal Memo 9'),
  ('portfolio-v1','Jai Kisan','Fintech (rural credit)','Financing for farmers', array['rural credit','agri credit','lending','financing'], array['farmers','rural households'], array['channel partners','nbfc'], 'Deal Memo 11'),
  ('portfolio-v1','MeetRecord','B2B software','Meeting notes and call summaries', array['call summaries','meeting notes','transcription','call recording'], array['sales teams'], array['crm'], 'Partner Meeting Notes, Meeting 4')
on conflict do nothing;

insert into availability_rules (person, weekday, start_time, end_time) values
  ('kushal',2,'14:00','18:00'),('kushal',4,'14:00','18:00'),
  ('aditya',2,'15:00','18:00'),('aditya',4,'14:00','17:00'),
  ('riya',2,'14:00','18:00'),('riya',4,'14:00','18:00');
