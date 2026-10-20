import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore, UNBOUND_DESTINATION } from "@builderforce/local-first";
import { createVsCodeLocalWorkManagement } from "./localWorkManagement";

describe("VSIX local work management", () => {
  it("does not import the web app, bfApi, vscode, or fetch", () => {
    const source = readFileSync(new URL("./localWorkManagement.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*frontend/);
    expect(source).not.toMatch(/from\s+["'][^"']*workManagement["']/);
    expect(source).not.toMatch(/from\s+["']\.\/bfApi["']/);
    expect(source).not.toMatch(/from\s+["']vscode["']/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it("is not called from extension activation", () => {
    const activation = readFileSync(new URL("./extension.ts", import.meta.url), "utf8");
    expect(activation).not.toContain("localWorkManagement");
  });

  it("creates, edits, and reads a project and a ticket with no network, and a restarted store still sees them", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network must not be used"));
    const store = createMemoryLocalFirstStore();
    let tick = 0;
    let ids = 0;
    const work = createVsCodeLocalWorkManagement({
      store,
      deviceId: "device-vsix",
      now: () => new Date(Date.UTC(2026, 9, 18, 0, 0, tick++)),
      newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    });

    try {
      const project = await work.createProject({ name: "  Offline  ", key: "OFF" });
      const editedProject = await work.updateProject(project.id, { name: "Offline renamed" });
      const ticket = await work.createTicket({
        projectId: project.id,
        title: "  Write it down  ",
        description: "local only",
        priority: "high",
      });
      const editedTicket = await work.updateTicket(ticket.id, {
        title: "Written down",
        description: "edited locally",
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(project.destination).toEqual(UNBOUND_DESTINATION);
      expect(project.payload).toEqual({ name: "Offline", key: "OFF" });
      expect(editedProject.version).toBe(project.version + 1);
      expect(editedProject.payload.name).toBe("Offline renamed");
      expect(ticket.destination).toEqual(UNBOUND_DESTINATION);
      expect(ticket.payload).toMatchObject({
        projectId: project.id,
        title: "Write it down",
        status: "backlog",
        description: "local only",
        priority: "high",
      });
      expect(editedTicket.payload.title).toBe("Written down");
      expect(editedTicket.payload.description).toBe("edited locally");

      expect(await work.readProject(project.id)).toEqual(editedProject);
      expect(await work.readTicket(ticket.id)).toEqual(editedTicket);
      expect(await work.listProjects()).toEqual([editedProject]);
      expect(await work.listTickets({ projectId: project.id })).toEqual([editedTicket]);

      const snapshot = JSON.parse(JSON.stringify(await store.export())) as Awaited<ReturnType<typeof store.export>>;
      const restarted = createVsCodeLocalWorkManagement({
        store: createMemoryLocalFirstStore(snapshot),
        deviceId: "device-vsix",
      });
      expect(await restarted.readProject(project.id)).toMatchObject({
        id: project.id,
        payload: { name: "Offline renamed", key: "OFF" },
        destination: UNBOUND_DESTINATION,
      });
      expect(await restarted.readTicket(ticket.id)).toMatchObject({
        id: ticket.id,
        payload: {
          projectId: project.id,
          title: "Written down",
          description: "edited locally",
          status: "backlog",
          priority: "high",
        },
        destination: UNBOUND_DESTINATION,
      });
      expect(await restarted.listProjects()).toHaveLength(1);
      expect(await restarted.listTickets()).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
