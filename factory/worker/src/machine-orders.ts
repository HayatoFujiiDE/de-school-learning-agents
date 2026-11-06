// 機械用の注文の記録（契約 §U-3）の読み取り。画面用の応答（§U-4）が使う。client の文字列は画面に出さない（出すかどうかは画面側）
import { first, stmt } from './db';

export interface MachineOrderView {
  client: string;
  created_at: string;
}

/** その job を作った機械用の注文（無ければ null） */
export async function machineOrderForJob(db: D1Database, jobId: string): Promise<MachineOrderView | null> {
  return first<MachineOrderView>(db, stmt('SELECT client, created_at FROM machine_orders WHERE job_id = ? LIMIT 1', jobId));
}

/** その素材の最初の機械用の注文（無ければ null） */
export async function machineOrderForMaterial(db: D1Database, materialId: string): Promise<MachineOrderView | null> {
  return first<MachineOrderView>(
    db,
    stmt('SELECT client, created_at FROM machine_orders WHERE material_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1', materialId),
  );
}
