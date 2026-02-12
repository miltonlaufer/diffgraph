import neo4j, { type Driver } from "neo4j-driver";
import type { SnapshotGraph } from "./schema.js";

const memorySnapshots = new Map<string, SnapshotGraph>();

const keyFor = (repoId: string, snapshotId: string): string => `${repoId}:${snapshotId}`;

export class Neo4jStore {
  private driver: Driver | null = null;

  public constructor(
    private readonly uri?: string,
    private readonly username?: string,
    private readonly password?: string,
  ) {}

  public async connect(): Promise<void> {
    if (!this.uri || !this.username || !this.password) {
      return;
    }

    this.driver = neo4j.driver(this.uri, neo4j.auth.basic(this.username, this.password));
    await this.driver.verifyConnectivity();
  }

  public async close(): Promise<void> {
    await this.driver?.close();
  }

  public async saveSnapshot(graph: SnapshotGraph): Promise<void> {
    memorySnapshots.set(keyFor(graph.repoId, graph.snapshotId), graph);

    if (!this.driver) {
      return;
    }

    const session = this.driver.session();
    try {
      await session.executeWrite(async (tx) => {
        await tx.run(
          `
          MERGE (s:Snapshot {repoId: $repoId, snapshotId: $snapshotId})
          SET s.ref = $ref
          `,
          { repoId: graph.repoId, snapshotId: graph.snapshotId, ref: graph.ref },
        );

        for (const node of graph.nodes) {
          await tx.run(
            `
            MERGE (n:CodeSymbol {id: $id, snapshotId: $snapshotId, repoId: $repoId})
            SET n += $props
            `,
            {
              id: node.id,
              repoId: graph.repoId,
              snapshotId: graph.snapshotId,
              props: node,
            },
          );
        }

        for (const edge of graph.edges) {
          await tx.run(
            `
            MATCH (a:CodeSymbol {id: $source, snapshotId: $snapshotId, repoId: $repoId})
            MATCH (b:CodeSymbol {id: $target, snapshotId: $snapshotId, repoId: $repoId})
            MERGE (a)-[r:REL {id: $id, snapshotId: $snapshotId, repoId: $repoId}]->(b)
            SET r += $props
            `,
            {
              id: edge.id,
              source: edge.source,
              target: edge.target,
              repoId: graph.repoId,
              snapshotId: graph.snapshotId,
              props: edge,
            },
          );
        }
      });
    } finally {
      await session.close();
    }
  }

  public async getSnapshot(repoId: string, snapshotId: string): Promise<SnapshotGraph | null> {
    const inMemory = memorySnapshots.get(keyFor(repoId, snapshotId));
    if (inMemory) {
      return inMemory;
    }

    if (!this.driver) {
      return null;
    }

    const session = this.driver.session();
    try {
      const nodeResult = await session.run(
        `
        MATCH (n:CodeSymbol {repoId: $repoId, snapshotId: $snapshotId})
        RETURN n
        `,
        { repoId, snapshotId },
      );
      const edgeResult = await session.run(
        `
        MATCH (:CodeSymbol {repoId: $repoId, snapshotId: $snapshotId})-[r:REL {repoId: $repoId, snapshotId: $snapshotId}]->(:CodeSymbol {repoId: $repoId, snapshotId: $snapshotId})
        RETURN r
        `,
        { repoId, snapshotId },
      );

      if (nodeResult.records.length === 0) {
        return null;
      }

      return {
        repoId,
        snapshotId,
        ref: String(nodeResult.records[0].get("n").properties.ref ?? "unknown"),
        nodes: nodeResult.records.map((record) => record.get("n").properties as SnapshotGraph["nodes"][number]),
        edges: edgeResult.records.map((record) => record.get("r").properties as SnapshotGraph["edges"][number]),
      };
    } finally {
      await session.close();
    }
  }
}
