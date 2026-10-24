import { asc } from "drizzle-orm";
import type { Translations } from "@/lib/translations";
import type { Db } from "@/server/db/client";
import { pipelineStage } from "@/server/db/schema";
import { runPublic } from "./as-actor";

export interface PipelineStageRow {
  code: string;
  position: number;
  name: Translations;
}

/** The six stages in order (architecture 7.2). Reference data, readable by everyone. */
export async function listPipelineStages(db: Db): Promise<PipelineStageRow[]> {
  const [rows] = await runPublic(db, db.select().from(pipelineStage).orderBy(asc(pipelineStage.position)));
  return rows;
}
