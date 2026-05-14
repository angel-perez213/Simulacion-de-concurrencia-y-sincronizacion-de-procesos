const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const BASE_W = 1320;
const BASE_H = 690;

// Escalado de alta calidad para que el canvas no se mire borroso.
// El canvas se dibuja con coordenadas lógicas BASE_W x BASE_H,
// pero internamente usa devicePixelRatio para verse nítido en navegador.
let renderScale = 1;
let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5));

const COLORS = {
    space: "#02060d",
    ship: "#14203a",
    ship2: "#1e2e4c",
    bay: "#22334f",
    cyan: "#00f5ff",
    green: "#00ff8a",
    yellow: "#fff000",
    orange: "#ff9f1c",
    red: "#ff4d5d",
    blue: "#4d9bff",
    purple: "#b889ff",
    white: "#f2f6ff",
    muted: "#9ca8c0",
    black: "#000000",
    terminal: "#00140a",
    terminal2: "#002414",
};

const STATE_COLORS = {
    New: "#818a9c",
    Ready: "#4d9bff",
    Running: "#44ff73",
    Waiting: "#ffcc33",
    Terminated: "#ff4d5d",
};

const ProcessState = {
    NEW: "New",
    READY: "Ready",
    RUNNING: "Running",
    WAITING: "Waiting",
    TERMINATED: "Terminated",
};

const SchedulerAlgorithm = {
    FIFO: "FIFO",
    SJF: "SJF",
    RR: "Round Robin",
    PRIORITY: "Prioridad",
};

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function nowStamp() {
    return new Date().toLocaleTimeString("es-GT", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

class RobotProcess {
    constructor(pid) {
        this.pid = pid;
        this.name = `Robot-${pid}`;
        this.burstTime = randInt(5, 15);
        this.priority = randInt(1, 5);
        this.pagesNeeded = randInt(2, 5);
        this.createdAt = Date.now();
        this.state = ProcessState.NEW;
        this.newTicks = 2;
        this.remainingTime = this.burstTime;
        this.executedTime = 0;
        this.waitTicks = 0;
        this.waitingReason = "";
        this.readyOrder = 0;
        this.quantumUsed = 0;
        this.frames = [];
        this.x = 245 + randInt(-25, 25);
        this.y = 250 + randInt(-10, 40);
        this.targetX = 245;
        this.targetY = 250;
        this.task = "New / Creado";
    }

    shortName() {
        return `R${this.pid}`;
    }

    progress() {
        if (this.burstTime <= 0) return 1;
        return (this.burstTime - this.remainingTime) / this.burstTime;
    }
}

class MemoryManager {
    constructor(totalFrames = 32) {
        this.totalFrames = totalFrames;
        this.frames = Array(totalFrames).fill(null);
        this.pageTable = new Map();
    }

    freeCount() {
        return this.frames.filter(frame => frame === null).length;
    }

    usedCount() {
        return this.totalFrames - this.freeCount();
    }

    allocate(process) {
        if (this.freeCount() < process.pagesNeeded) return false;
        const assigned = [];
        for (let i = 0; i < this.frames.length; i++) {
            if (this.frames[i] === null) {
                this.frames[i] = process.pid;
                assigned.push(i);
                if (assigned.length === process.pagesNeeded) break;
            }
        }
        this.pageTable.set(process.pid, assigned);
        process.frames = assigned;
        return true;
    }

    free(pid) {
        this.frames = this.frames.map(frame => frame === pid ? null : frame);
        this.pageTable.delete(pid);
    }
}

class FileNode {
    constructor(name, isDir = false, content = "", permissions = "rw-") {
        this.name = name;
        this.isDir = isDir;
        this.content = content;
        this.permissions = permissions;
        this.children = new Map();
    }
}

class ConceptualFileSystem {
    constructor() {
        this.root = new FileNode("/", true, "", "rwx");
        this.mkdir("/logs");
        this.mkdir("/robots");
        this.createFile("/logs/bitacora.txt", "NaveOS iniciado.");
        this.createFile("/robots/manual.txt", "Manual de robots de mantenimiento.");
    }

    parts(path) {
        let clean = String(path || "").trim();
        if (!clean.startsWith("/")) clean = `/${clean}`;
        return clean.split("/").filter(Boolean);
    }

    getNode(path) {
        if (path === "/") return this.root;
        let current = this.root;
        for (const part of this.parts(path)) {
            if (!current.isDir || !current.children.has(part)) return null;
            current = current.children.get(part);
        }
        return current;
    }

    getParent(path) {
        const parts = this.parts(path);
        if (!parts.length) return [null, ""];
        let current = this.root;
        for (const part of parts.slice(0, -1)) {
            if (!current.children.has(part) || !current.children.get(part).isDir) {
                return [null, parts[parts.length - 1]];
            }
            current = current.children.get(part);
        }
        return [current, parts[parts.length - 1]];
    }

    mkdir(path) {
        const [parent, name] = this.getParent(path);
        if (!parent || !name || parent.children.has(name)) {
            return [false, "No se pudo crear el directorio."];
        }
        parent.children.set(name, new FileNode(name, true, "", "rwx"));
        return [true, `Directorio creado: ${path}`];
    }

    createFile(path, content = "") {
        const [parent, name] = this.getParent(path);
        if (!parent || !name || parent.children.has(name)) {
            return [false, "No se pudo crear el archivo."];
        }
        parent.children.set(name, new FileNode(name, false, content, "rw-"));
        return [true, `Archivo creado: ${path}`];
    }

    writeFile(path, content) {
        const node = this.getNode(path);
        if (!node || node.isDir) return [false, "Archivo no encontrado."];
        if (!node.permissions.includes("w")) return [false, "Permiso denegado."];
        node.content = content;
        return [true, `Archivo actualizado: ${path}`];
    }

    readFile(path) {
        const node = this.getNode(path);
        if (!node || node.isDir) return [false, "Archivo no encontrado."];
        if (!node.permissions.includes("r")) return [false, "Permiso denegado."];
        return [true, node.content];
    }

    delete(path) {
        const [parent, name] = this.getParent(path);
        if (!parent || !parent.children.has(name)) return [false, "Ruta no encontrada."];
        parent.children.delete(name);
        return [true, `Eliminado: ${path}`];
    }

    treeLines() {
        const lines = ["/ [rwx]"];
        const walk = (node, prefix = "  ") => {
            const entries = Array.from(node.children.entries()).sort(([a], [b]) => a.localeCompare(b));
            for (const [name, child] of entries) {
                const kind = child.isDir ? "DIR " : "FILE";
                lines.push(`${prefix}${kind} ${name} [${child.permissions}]`);
                if (child.isDir) walk(child, `${prefix}  `);
            }
        };
        walk(this.root);
        return lines.slice(0, 9);
    }
}

class SpaceOperatingSystem {
    constructor() {
        this.processes = new Map();
        this.nextPid = 1;
        this.readySequence = 0;
        this.runningPid = null;
        this.memory = new MemoryManager(32);
        this.fs = new ConceptualFileSystem();
        this.algorithm = SchedulerAlgorithm.RR;
        this.rrQuantum = 3;
        this.tickSpeed = 0.8;
        this.totalTicks = 0;
        this.paused = false;
        this.logs = [];
        this.terminalLines = [];
        this.criticalSectionEnabled = false;
        this.criticalOwner = null;
        this.criticalTimer = 0;
        this.deadlockActive = false;
        this.resourceOwner = {};
        this.resourceWait = {};
        this.autoRestockCounter = 0;

        this.addLog("NaveOS listo. Presiona Abrir Terminal o usa los botones.");
        this.terminalPrint("Terminal lista.");
        this.terminalPrint('Escribe "help" para ver los comandos.');
        for (let i = 0; i < 4; i++) this.createProcess(true);
    }

    capList(list, max) {
        while (list.length > max) list.shift();
    }

    addLog(message) {
        this.logs.unshift(`[${nowStamp()}] ${message}`);
        this.capList(this.logs, 160);
    }

    terminalPrint(message) {
        this.terminalLines.push(message);
        this.capList(this.terminalLines, 220);
        renderTerminal();
    }

    createProcess(auto = false) {
        const pid = this.nextPid++;
        const robot = new RobotProcess(pid);
        this.processes.set(pid, robot);
        this.addLog(`${robot.shortName()} creado en estado New.`);
        this.terminalPrint(`Robot ${robot.shortName()} creado en estado New.`);
        return robot;
    }

    terminateProcess(pid, reason = "finalizado") {
        const robot = this.processes.get(pid);
        if (!robot) return false;
        if (robot.state === ProcessState.TERMINATED) return true;
        if (this.runningPid === pid) this.runningPid = null;
        if (this.criticalOwner === pid) this.releaseCriticalSection();
        this.memory.free(pid);
        robot.state = ProcessState.TERMINATED;
        robot.remainingTime = 0;
        robot.waitingReason = reason;
        robot.task = reason;
        this.addLog(`${robot.shortName()} ${reason}. Memoria liberada.`);
        return true;
    }

    moveToReady(robot) {
        this.readySequence++;
        robot.state = ProcessState.READY;
        robot.waitingReason = "";
        robot.readyOrder = this.readySequence;
        robot.quantumUsed = 0;
    }

    readyProcesses() {
        return Array.from(this.processes.values()).filter(r => r.state === ProcessState.READY);
    }

    waitingProcesses() {
        return Array.from(this.processes.values()).filter(r => r.state === ProcessState.WAITING);
    }

    runningProcess() {
        if (this.runningPid === null) return null;
        return this.processes.get(this.runningPid) || null;
    }

    activeProcesses() {
        return Array.from(this.processes.values()).filter(r => r.state !== ProcessState.TERMINATED);
    }

    setAlgorithm(algorithm) {
        const running = this.runningProcess();
        if (running && running.state === ProcessState.RUNNING) {
            this.moveToReady(running);
            this.runningPid = null;
        }
        this.algorithm = algorithm;
        this.addLog(`Modo actual cambiado a ${algorithm}.`);
        this.terminalPrint(`Algoritmo activo: ${algorithm}`);
    }

    selectNextProcess() {
        const ready = this.readyProcesses();
        if (!ready.length) return null;

        if (this.algorithm === SchedulerAlgorithm.FIFO) {
            return ready.sort((a, b) => a.readyOrder - b.readyOrder)[0];
        }
        if (this.algorithm === SchedulerAlgorithm.SJF) {
            return ready.sort((a, b) =>
                a.remainingTime - b.remainingTime || a.readyOrder - b.readyOrder || a.pid - b.pid
            )[0];
        }
        if (this.algorithm === SchedulerAlgorithm.PRIORITY) {
            return ready.sort((a, b) =>
                a.priority - b.priority || a.readyOrder - b.readyOrder || a.pid - b.pid
            )[0];
        }
        return ready.sort((a, b) => a.readyOrder - b.readyOrder)[0];
    }

    dispatchCpu() {
        const robot = this.selectNextProcess();
        if (!robot) return;
        robot.state = ProcessState.RUNNING;
        robot.quantumUsed = 0;
        this.runningPid = robot.pid;
        this.addLog(`CPU asignada a ${robot.shortName()}.`);
    }

    toggleMutex() {
        this.criticalSectionEnabled = !this.criticalSectionEnabled;
        const state = this.criticalSectionEnabled ? "activado" : "desactivado";
        this.addLog(`Mutex ${state}.`);
        this.terminalPrint(`Mutex ${state}.`);
        if (!this.criticalSectionEnabled) this.releaseCriticalSection();
    }

    requestCriticalSection(robot) {
        if (this.criticalOwner === null) {
            this.criticalOwner = robot.pid;
            this.criticalTimer = randInt(2, 4);
            robot.task = "En sección crítica";
            this.addLog(`${robot.shortName()} entró a sección crítica.`);
            return;
        }

        if (this.criticalOwner !== robot.pid) {
            robot.state = ProcessState.WAITING;
            robot.waitTicks = 2;
            robot.waitingReason = "Esperando mutex";
            this.runningPid = null;
            this.addLog(`${robot.shortName()} espera el mutex.`);
        }
    }

    releaseCriticalSection() {
        if (this.criticalOwner !== null) {
            this.criticalOwner = null;
            this.criticalTimer = 0;
            this.addLog("Mutex liberado.");
        }
    }

    tickCritical(running) {
        if (!this.criticalSectionEnabled || !running) return;
        if (this.criticalOwner === running.pid) {
            this.criticalTimer--;
            if (this.criticalTimer <= 0) this.releaseCriticalSection();
            return;
        }
        if (Math.random() < 0.20) this.requestCriticalSection(running);
    }

    createDeadlock() {
        const active = Array.from(this.processes.values()).filter(r =>
            r.state === ProcessState.READY || r.state === ProcessState.RUNNING
        );
        if (active.length < 2) {
            this.addLog("No hay suficientes robots para crear deadlock.");
            this.terminalPrint("No hay suficientes robots para crear deadlock.");
            return;
        }
        const [a, b] = active;
        if ([a.pid, b.pid].includes(this.runningPid)) this.runningPid = null;
        a.state = ProcessState.WAITING;
        b.state = ProcessState.WAITING;
        a.waitingReason = "Espera batería";
        b.waitingReason = "Espera herramientas";
        a.waitTicks = 999;
        b.waitTicks = 999;
        this.resourceOwner = { "ENERGÍA": a.pid, "HERRAMIENTAS": b.pid };
        this.resourceWait = { [a.pid]: "HERRAMIENTAS", [b.pid]: "ENERGÍA" };
        this.deadlockActive = true;
        this.addLog(`Deadlock detectado entre ${a.shortName()} y ${b.shortName()}.`);
        this.terminalPrint("Deadlock creado: dos robots se esperan entre sí.");
    }

    resolveDeadlock() {
        if (!this.deadlockActive) {
            this.addLog("No hay deadlock activo.");
            this.terminalPrint("No hay deadlock activo.");
            return;
        }
        const victims = Object.keys(this.resourceWait).map(Number);
        if (victims.length) this.terminateProcess(victims[0], "terminado para resolver deadlock");
        for (const pid of victims) {
            const robot = this.processes.get(pid);
            if (robot && robot.state !== ProcessState.TERMINATED) {
                robot.waitTicks = 0;
                this.moveToReady(robot);
            }
        }
        this.resourceOwner = {};
        this.resourceWait = {};
        this.deadlockActive = false;
        this.addLog("Deadlock resuelto liberando recursos.");
        this.terminalPrint("Deadlock resuelto.");
    }

    runExternalDiagnostic() {
        const snapshot = {
            running: this.runningProcess() ? 1 : 0,
            ready: this.readyProcesses().length,
            waiting: this.waitingProcesses().length,
            memUsed: this.memory.usedCount(),
        };
        this.addLog("Diagnóstico externo iniciado.");
        this.terminalPrint("Diagnóstico externo iniciado.");
        setTimeout(() => {
            const score = snapshot.running * 30 + snapshot.ready * 7 + snapshot.waiting * 5 + snapshot.memUsed * 2 + randInt(1, 10);
            const msg = `Diagnóstico externo: carga estimada ${Math.min(score, 100)}%.`;
            this.addLog(msg);
            this.terminalPrint(msg);
        }, 420);
    }

    tick() {
        if (this.paused) return;
        this.totalTicks++;

        for (const robot of Array.from(this.processes.values()).filter(r => r.state === ProcessState.NEW)) {
            robot.newTicks--;
            if (robot.newTicks <= 0) {
                if (this.memory.allocate(robot)) {
                    this.moveToReady(robot);
                    this.addLog(`${robot.shortName()} pasa de New a Ready.`);
                } else {
                    robot.state = ProcessState.WAITING;
                    robot.waitTicks = 3;
                    robot.waitingReason = "Sin memoria";
                    robot.task = "Sin memoria";
                    this.addLog(`${robot.shortName()} pasa a Waiting por falta de memoria.`);
                }
            }
        }

        if (this.activeProcesses().length === 0) {
            this.autoRestockCounter++;
            if (this.autoRestockCounter >= 3) {
                this.autoRestockCounter = 0;
                for (let i = 0; i < 4; i++) this.createProcess();
                this.addLog("Nuevo grupo de robots enviado a la nave.");
            }
        } else {
            this.autoRestockCounter = 0;
        }

        for (const robot of this.waitingProcesses()) {
            if (this.deadlockActive && Object.prototype.hasOwnProperty.call(this.resourceWait, robot.pid)) continue;
            if (robot.waitTicks > 0) robot.waitTicks--;
            if (robot.waitTicks <= 0) {
                if (robot.waitingReason === "Sin memoria") {
                    if (this.memory.allocate(robot)) this.moveToReady(robot);
                } else {
                    this.moveToReady(robot);
                    this.addLog(`${robot.shortName()} vuelve a Ready.`);
                }
            }
        }

        let running = this.runningProcess();
        if (!running || running.state !== ProcessState.RUNNING) {
            this.dispatchCpu();
            running = this.runningProcess();
        }
        if (!running) return;

        this.tickCritical(running);
        if (running.state !== ProcessState.RUNNING) return;

        running.remainingTime--;
        running.executedTime++;
        running.quantumUsed++;

        if (running.remainingTime > 0 && Math.random() < 0.10) {
            running.state = ProcessState.WAITING;
            running.waitTicks = randInt(1, 3);
            running.waitingReason = "Revisando panel";
            running.task = "Revisando panel";
            this.runningPid = null;
            this.addLog(`${running.shortName()} pasa a Waiting por E/S.`);
            return;
        }

        if (running.remainingTime <= 0) {
            this.terminateProcess(running.pid, "completó su misión");
            return;
        }

        if (this.algorithm === SchedulerAlgorithm.RR && running.quantumUsed >= this.rrQuantum) {
            this.moveToReady(running);
            this.runningPid = null;
            this.addLog(`${running.shortName()} sale de CPU por quantum.`);
        }
    }

    assignTargets() {
        const newProcesses = Array.from(this.processes.values()).filter(r => r.state === ProcessState.NEW).sort((a, b) => a.pid - b.pid);
        const ready = this.readyProcesses().sort((a, b) => a.readyOrder - b.readyOrder);
        const waiting = this.waitingProcesses().sort((a, b) => a.pid - b.pid);
        const terminated = Array.from(this.processes.values()).filter(r => r.state === ProcessState.TERMINATED).sort((a, b) => a.pid - b.pid).slice(-3);
        const pulse = 8 * [-1, 0, 1][randInt(0, 2)];

        newProcesses.slice(0, 5).forEach((robot, i) => {
            robot.targetX = 250 + (i % 2) * 90 + pulse;
            robot.targetY = 315 + Math.floor(i / 2) * 90;
            robot.task = "New / Creado";
        });

        const running = this.runningProcess();
        if (running) {
            running.targetX = 560 + pulse;
            running.targetY = 360;
            running.task = "Ejecutando CPU";
        }

        ready.slice(0, 8).forEach((robot, i) => {
            robot.targetX = 500 + (i % 3) * 60 + pulse;
            robot.targetY = 295 + Math.floor(i / 3) * 82;
            robot.task = "Listo / Ready";
        });

        waiting.slice(0, 6).forEach((robot, i) => {
            robot.targetX = 720 + (i % 3) * 70 + pulse;
            robot.targetY = 330 + Math.floor(i / 3) * 90;
            robot.task = robot.waitingReason || "Esperando E/S";
        });

        terminated.forEach((robot, i) => {
            robot.targetX = 965 + i * 60;
            robot.targetY = 505;
            robot.task = "Terminado";
        });
    }

    updateRobotPositions() {
        this.assignTargets();
        for (const robot of this.processes.values()) {
            robot.x += (robot.targetX - robot.x) * 0.15;
            robot.y += (robot.targetY - robot.y) * 0.15;
        }
    }

    enqueueCommand(command) {
        this.handleCommand(command);
    }

    handleCommand(raw) {
        raw = String(raw || "").trim();
        if (!raw) return;
        const parts = raw.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        this.terminalPrint(`MiShell> ${raw}`);

        if (cmd === "help") {
            this.terminalPrint("Comandos principales:");
            this.terminalPrint("create [n] | kill PID | alg fifo|sjf|rr|prio | rrq N");
            this.terminalPrint("mutex | deadlock | resolve | mpdiag | pause | resume | speed N");
            this.terminalPrint("ps | status | clear");
            this.terminalPrint("Sistema de archivos:");
            this.terminalPrint("fs ls | fs mkdir /carpeta | fs touch /archivo.txt");
            this.terminalPrint("fs write /archivo.txt texto | fs read /archivo.txt | fs rm /archivo.txt");
            this.terminalPrint("Atajos: ls, mkdir, touch, write, read, cat, rm");
            return;
        }

        if (cmd === "create") {
            let amount = 1;
            if (parts.length > 1 && /^\d+$/.test(parts[1])) amount = clamp(parseInt(parts[1], 10), 1, 10);
            for (let i = 0; i < amount; i++) this.createProcess();
            return;
        }

        if (cmd === "kill" && parts.length > 1) {
            const pid = parseInt(parts[1], 10);
            if (Number.isNaN(pid)) this.terminalPrint("Uso: kill PID");
            else if (!this.terminateProcess(pid, "finalizado manualmente")) this.terminalPrint("PID no encontrado.");
            return;
        }

        if (cmd === "alg" && parts.length > 1) {
            this.setAlgorithmFromText(parts[1]);
            return;
        }

        if (["fifo", "sjf", "rr", "prio", "prioridad"].includes(cmd)) {
            this.setAlgorithmFromText(cmd);
            return;
        }

        if (["rrq", "quantum"].includes(cmd)) {
            if (parts.length > 1 && /^\d+$/.test(parts[1])) {
                this.rrQuantum = clamp(parseInt(parts[1], 10), 1, 10);
                this.terminalPrint(`Quantum actualizado a ${this.rrQuantum}.`);
            } else {
                this.terminalPrint("Uso: rrq 3");
            }
            return;
        }

        if (cmd === "mutex") return this.toggleMutex();
        if (cmd === "deadlock") return this.createDeadlock();
        if (cmd === "resolve") return this.resolveDeadlock();
        if (cmd === "mpdiag") return this.runExternalDiagnostic();
        if (cmd === "pause") {
            this.paused = true;
            this.addLog("Simulación pausada.");
            this.terminalPrint("Simulación pausada.");
            return;
        }
        if (cmd === "resume") {
            this.paused = false;
            this.addLog("Simulación reanudada.");
            this.terminalPrint("Simulación reanudada.");
            return;
        }
        if (cmd === "speed" && parts.length > 1) {
            const speed = parseFloat(parts[1]);
            if (Number.isNaN(speed)) this.terminalPrint("Uso: speed 0.5");
            else {
                this.tickSpeed = clamp(speed, 0.15, 3.0);
                this.terminalPrint(`Velocidad configurada en ${this.tickSpeed}s.`);
            }
            return;
        }
        if (cmd === "clear") {
            this.terminalLines = [];
            renderTerminal(true);
            return;
        }
        if (["ps", "status"].includes(cmd)) return this.terminalStatus();
        if (cmd === "fs") return this.handleFs(parts, raw);
        if (["ls", "mkdir", "touch", "write", "read", "cat", "rm", "del"].includes(cmd)) {
            const fsCmd = cmd === "cat" ? "read" : cmd === "del" ? "rm" : cmd;
            const fsParts = ["fs", fsCmd, ...parts.slice(1)];
            const fsRaw = `fs ${fsCmd}${raw.length > parts[0].length ? raw.slice(parts[0].length) : ""}`;
            return this.handleFs(fsParts, fsRaw);
        }
        this.terminalPrint("Comando desconocido. Escribe help.");
    }

    setAlgorithmFromText(value) {
        const v = String(value || "").toLowerCase();
        if (v === "fifo") this.setAlgorithm(SchedulerAlgorithm.FIFO);
        else if (v === "sjf") this.setAlgorithm(SchedulerAlgorithm.SJF);
        else if (v === "rr") this.setAlgorithm(SchedulerAlgorithm.RR);
        else if (v === "prio" || v === "prioridad") this.setAlgorithm(SchedulerAlgorithm.PRIORITY);
        else this.terminalPrint("Algoritmo inválido. Usa fifo, sjf, rr o prio.");
    }

    normalizePath(path) {
        let clean = String(path || "").trim();
        if (!clean) return "/";
        if (!clean.startsWith("/")) clean = `/${clean}`;
        return clean;
    }

    terminalStatus() {
        const running = this.runningProcess();
        const ready = this.readyProcesses();
        const waiting = this.waitingProcesses();
        this.terminalPrint(`Algoritmo: ${this.algorithm} | Tick: ${this.totalTicks} | Quantum: ${this.rrQuantum}`);
        this.terminalPrint(`Running: ${running ? running.shortName() : "-"} | Ready: ${ready.length} | Waiting: ${waiting.length}`);
        this.terminalPrint(`Memoria usada: ${this.memory.usedCount()}/${this.memory.totalFrames} marcos`);
        const active = this.activeProcesses();
        if (active.length) this.terminalPrint(active.slice(0, 12).map(r => `${r.shortName()}:${r.state}`).join(", "));
    }

    handleFs(parts, raw) {
        if (parts.length < 2) {
            this.terminalPrint("Uso: fs ls | fs mkdir /carpeta | fs touch /archivo.txt | fs write /archivo.txt texto | fs read /archivo.txt | fs rm /archivo.txt");
            return;
        }
        const sub = parts[1].toLowerCase();
        if (sub === "ls") {
            for (const line of this.fs.treeLines()) this.terminalPrint(line);
            return;
        }
        if (sub === "mkdir") {
            if (parts.length < 3) return this.terminalPrint("Uso: fs mkdir /nombre_carpeta");
            const path = this.normalizePath(parts[2]);
            const [, msg] = this.fs.mkdir(path);
            this.terminalPrint(msg);
            return;
        }
        if (sub === "touch") {
            if (parts.length < 3) return this.terminalPrint("Uso: fs touch /archivo.txt");
            const path = this.normalizePath(parts[2]);
            const [, msg] = this.fs.createFile(path);
            this.terminalPrint(msg);
            return;
        }
        if (sub === "write") {
            if (parts.length < 4) return this.terminalPrint("Uso: fs write /archivo.txt contenido del archivo");
            const path = this.normalizePath(parts[2]);
            const content = raw.includes(parts[2]) ? raw.split(parts[2], 2)[1].trim() : parts.slice(3).join(" ");
            const [, msg] = this.fs.writeFile(path, content);
            this.terminalPrint(msg);
            return;
        }
        if (sub === "read") {
            if (parts.length < 3) return this.terminalPrint("Uso: fs read /archivo.txt");
            const path = this.normalizePath(parts[2]);
            const [ok, msg] = this.fs.readFile(path);
            this.terminalPrint(ok ? msg : `Error: ${msg}`);
            return;
        }
        if (sub === "rm") {
            if (parts.length < 3) return this.terminalPrint("Uso: fs rm /archivo.txt");
            const path = this.normalizePath(parts[2]);
            const [, msg] = this.fs.delete(path);
            this.terminalPrint(msg);
            return;
        }
        this.terminalPrint("Comando FS inválido. Ejemplo: fs touch /nota.txt");
    }

    snapshot() {
        return {
            processes: Array.from(this.processes.values()),
            running: this.runningProcess(),
            ready: this.readyProcesses(),
            waiting: this.waitingProcesses(),
            algorithm: this.algorithm,
            rrQuantum: this.rrQuantum,
            tickSpeed: this.tickSpeed,
            totalTicks: this.totalTicks,
            paused: this.paused,
            frames: [...this.memory.frames],
            usedMemory: this.memory.usedCount(),
            logs: [...this.logs],
            terminal: [...this.terminalLines],
            fsLines: this.fs.treeLines(),
            criticalEnabled: this.criticalSectionEnabled,
            criticalOwner: this.criticalOwner,
            criticalTimer: this.criticalTimer,
            deadlockActive: this.deadlockActive,
            resourceOwner: { ...this.resourceOwner },
        };
    }
}

function roundRect(ctx, x, y, w, h, r, fill = null, stroke = null, lineWidth = 1) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }
}

function text(x, y, value, size = 12, color = COLORS.white, anchor = "left", bold = false) {
    ctx.fillStyle = color;
    ctx.font = `${bold ? "bold " : ""}${size}px Consolas, Monaco, monospace`;
    ctx.textBaseline = "top";
    ctx.textAlign = anchor;
    ctx.fillText(String(value), x, y);
}

const stars = Array.from({ length: 110 }, () => ({
    x: randInt(0, BASE_W),
    y: randInt(0, BASE_H),
    s: [1, 1, 1, 2][randInt(0, 3)],
}));

function drawSpace() {
    ctx.fillStyle = COLORS.space;
    ctx.fillRect(0, 0, BASE_W, BASE_H);
    ctx.fillStyle = "#b7bdd1";
    for (const star of stars) {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.s, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawTopLabels(data) {
    roundRect(ctx, 15, 15, 235, 37, 8, "#101a2c", COLORS.cyan, 2);
    text(25, 26, `Modo actual: ${data.algorithm.toUpperCase()}`, 12, COLORS.white, "left", true);

    roundRect(ctx, 520, 18, 370, 52, 8, "#15150f", COLORS.yellow, 2);
    text(532, 30, `${data.algorithm.toUpperCase()}: robots/procesos se planifican en CPU`, 11, COLORS.white, "left", true);
    text(532, 50, "Estados: Ready, Running, Waiting y Terminated", 10, COLORS.muted);

    roundRect(ctx, 1180, 15, 125, 70, 8, "#06150b", COLORS.green, 2);
    text(1190, 25, "SISTEMA ACTIVO", 11, COLORS.green, "left", true);
    text(1190, 45, "NAVE OPERATIVA", 10, COLORS.white);
    text(1190, 65, `ROBOTS: ${data.processes.filter(p => p.state !== ProcessState.TERMINATED).length}`, 10, COLORS.white);

    roundRect(ctx, 1010, 95, 190, 98, 8, "#09111f", COLORS.cyan, 2);
    text(1022, 103, "ESTADOS", 10, COLORS.white, "left", true);
    const items = [
        ["New", "Creado"],
        ["Ready", "Listo"],
        ["Running", "CPU"],
        ["Waiting", "Espera"],
        ["Terminated", "Terminado"],
    ];
    items.forEach(([state, desc], i) => {
        const ly = 123 + i * 13;
        ctx.fillStyle = STATE_COLORS[state];
        ctx.beginPath();
        ctx.arc(1027, ly + 5, 5, 0, Math.PI * 2);
        ctx.fill();
        text(1040, ly - 1, `${state}: ${desc}`, 8, COLORS.muted);
    });

    if (data.deadlockActive) {
        roundRect(ctx, 930, 22, 200, 40, 8, "#21070a", COLORS.red, 2);
        text(945, 34, "DEADLOCK DETECTADO", 11, COLORS.red, "left", true);
    }
}

function drawShip() {
    roundRect(ctx, 145, 110, 1045, 515, 28, COLORS.ship, "#25375f", 3);

    [185, 305, 425, 545, 665, 785, 905, 1025].forEach(x => {
        roundRect(ctx, x, 140, 105, 380, 12, COLORS.ship2, "#304161", 1);
    });

    [400, 490, 580, 665, 755, 840].forEach(x => {
        roundRect(ctx, x, 125, 52, 27, 12, "#65729a", "#cbd6ff", 2);
        ctx.fillStyle = "#8ed2ff";
        ctx.fillRect(x + 8, 132, 14, 7);
    });

    roundRect(ctx, 195, 180, 145, 95, 10, "#4d8df7", "#dce7ff", 2);
    text(222, 200, "ENERGÍA", 16, COLORS.white);
    roundRect(ctx, 195, 410, 145, 95, 10, COLORS.orange, "#ffe0a6", 2);
    text(208, 432, "HERRAMIENTAS", 13, COLORS.white);

    roundRect(ctx, 470, 175, 150, 280, 16, "#22375f", "#25ffd0", 3);
    [195, 250, 305, 360, 415].forEach(y => {
        ctx.strokeStyle = COLORS.yellow;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(482, y);
        ctx.lineTo(608, y);
        ctx.stroke();
    });
    text(510, 184, "CPU", 11, COLORS.yellow, "left", true);
    text(492, 435, "READY", 9, COLORS.yellow);

    roundRect(ctx, 660, 190, 195, 310, 16, "#243654", "#3b4d70", 2);
    text(705, 205, "WAITING / E/S", 11, COLORS.muted, "left", true);

    roundRect(ctx, 885, 225, 290, 260, 18, "#f2f2f2", "#d8d8d8", 2);
    text(915, 247, "SISTEMA DE ARCHIVOS", 11, "#111111", "left", true);
    text(915, 269, "Mapa de memoria de procesos", 8, "#333333");
}

function drawMemorySmall(data) {
    const x = 915;
    const y = 315;
    const frames = data.frames;
    const used = data.usedMemory;
    const free = 32 - used;
    const palette = ["#4d9bff", "#44ff73", "#fff000", "#ff9f1c", "#b889ff", "#ff4d5d"];

    text(x, y - 25, `Memoria RAM: ${used}/32 marcos`, 9, "#222222", "left", true);
    text(x, y - 10, "Cada cuadro muestra el robot que usa ese marco", 8, "#555555");

    for (let i = 0; i < frames.length; i++) {
        const pid = frames[i];
        const cx = x + (i % 8) * 28;
        const cy = y + Math.floor(i / 8) * 20;
        const fill = pid === null ? "#d7d7d7" : palette[pid % palette.length];
        ctx.fillStyle = fill;
        ctx.fillRect(cx, cy, 24, 15);
        ctx.strokeStyle = "#888888";
        ctx.lineWidth = 1;
        ctx.strokeRect(cx, cy, 24, 15);
        text(cx + 4, cy + 2, pid === null ? "-" : `R${pid}`, 7, "#111111", "left", pid !== null);
    }

    const summaryY = y + 88;
    ctx.fillStyle = "#e1e1e1";
    ctx.fillRect(x, summaryY, 210, 12);
    ctx.strokeStyle = "#bbbbbb";
    ctx.strokeRect(x, summaryY, 210, 12);
    if (used > 0) {
        ctx.fillStyle = COLORS.blue;
        ctx.fillRect(x, summaryY, Math.floor(210 * used / 32), 12);
    }
    text(x, summaryY + 20, `Ocupados: ${used}    Libres: ${free}`, 8, "#222222");
    text(x, summaryY + 39, "R1, R2... = marcos asignados a robots", 8, "#333333");
}

function drawResourcesState(data) {
    const ownerEnergy = data.resourceOwner["ENERGÍA"];
    const ownerTools = data.resourceOwner["HERRAMIENTAS"];
    if (ownerEnergy) text(205, 282, `Asignado a R${ownerEnergy}`, 9, COLORS.yellow, "left", true);
    if (ownerTools) text(205, 512, `Asignado a R${ownerTools}`, 9, COLORS.yellow, "left", true);

    if (data.criticalEnabled) {
        roundRect(ctx, 690, 145, 180, 31, 8, "#08150e", COLORS.green, 2);
        const owner = data.criticalOwner;
        const msg = owner ? `Mutex: R${owner}` : "Mutex activo";
        text(704, 154, msg, 10, COLORS.green, "left", true);
    }
}

function drawProcessHud(data) {
    roundRect(ctx, 1145, 545, 170, 110, 8, "#101a2c", COLORS.cyan, 2);
    text(1155, 558, "CONTADORES", 12, COLORS.white);
    const running = data.running ? 1 : 0;
    text(1155, 580, `Running: ${running}`, 10, COLORS.green);
    text(1155, 600, `Ready: ${data.ready.length}`, 10, COLORS.blue);
    text(1155, 620, `Waiting: ${data.waiting.length}`, 10, COLORS.yellow);
    text(1235, 620, `Tick: ${data.totalTicks}`, 10, COLORS.muted);

    ctx.fillStyle = "#20263c";
    ctx.fillRect(1155, 640, 145, 12);
    ctx.strokeStyle = "#dce7ff";
    ctx.strokeRect(1155, 640, 145, 12);
    if (data.running) {
        ctx.fillStyle = COLORS.green;
        ctx.fillRect(1155, 640, Math.floor(145 * data.running.progress()), 12);
        text(1215, 638, `${Math.floor(data.running.progress() * 100)}%`, 9, COLORS.yellow, "left", true);
    }

    roundRect(ctx, 20, 540, 430, 122, 8, "#101a2c", COLORS.cyan, 2);
    text(32, 552, "BITÁCORA", 11, COLORS.yellow, "left", true);
    data.logs.slice(0, 5).forEach((line, i) => {
        text(32, 575 + i * 16, line, 9, COLORS.white);
    });
}

function drawRobot(robot) {
    const x = robot.x;
    const y = robot.y;
    const color = STATE_COLORS[robot.state] || COLORS.blue;

    ctx.fillStyle = "#07101d";
    ctx.beginPath();
    ctx.ellipse(x + 4, y + 52, 25, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#dbe8ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 2, y - 18);
    ctx.lineTo(x + 2, y - 8);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 2, y - 20, 4, 0, Math.PI * 2);
    ctx.fill();

    roundRect(ctx, x - 18, y - 8, 42, 30, 8, "#e9f0ff", "#91a0bf", 2);
    roundRect(ctx, x - 12, y + 2, 30, 16, 5, "#05403e", null, 1);
    ctx.fillStyle = COLORS.green;
    ctx.beginPath();
    ctx.arc(x - 4, y + 10, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 10, y + 10, 2, 0, Math.PI * 2);
    ctx.fill();

    roundRect(ctx, x - 15, y + 22, 36, 36, 7, color, "#c8d2e8", 2);
    ctx.fillStyle = "#0d1a24";
    ctx.fillRect(x - 8, y + 30, 22, 10);
    ctx.fillStyle = COLORS.red;
    ctx.beginPath();
    ctx.arc(x - 2, y + 35, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.yellow;
    ctx.beginPath();
    ctx.arc(x + 6, y + 35, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - 15, y + 32);
    ctx.lineTo(x - 28, y + 42);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 21, y + 32);
    ctx.lineTo(x + 33, y + 43);
    ctx.stroke();

    ctx.strokeStyle = "#d8b23b";
    ctx.beginPath();
    ctx.moveTo(x - 5, y + 58);
    ctx.lineTo(x - 10, y + 72);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 58);
    ctx.lineTo(x + 15, y + 72);
    ctx.stroke();

    text(x - 18, y + 60, `${robot.shortName()} - ${robot.state}`, 9, COLORS.cyan, "left", true);
    roundRect(ctx, x - 55, y + 42, 130, 22, 6, "#071111", "#138f83", 1);
    text(x - 47, y + 47, robot.task.slice(0, 18), 8, COLORS.white);
}

let os = null;
let lastTick = performance.now();

function render() {
    const now = performance.now();
    if (now - lastTick >= os.tickSpeed * 1000) {
        lastTick = now;
        os.tick();
    }
    os.updateRobotPositions();

    const data = os.snapshot();

    // Limpia en pixeles reales y luego regresa al sistema lógico de dibujo.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * renderScale, 0, 0, dpr * renderScale, 0, 0);
    ctx.imageSmoothingEnabled = true;

    drawSpace();
    drawTopLabels(data);
    drawShip();
    drawMemorySmall(data);
    drawResourcesState(data);
    data.processes.sort((a, b) => a.pid - b.pid).forEach(drawRobot);
    drawProcessHud(data);

    requestAnimationFrame(render);
}

function resizeCanvas() {
    const availableW = window.innerWidth;
    const availableH = Math.max(320, window.innerHeight - 44);

    // Conserva la proporción original del diseño del Python.
    // Si se estira diferente en ancho y alto, el texto y los cuadros se ven borrosos.
    renderScale = Math.min(availableW / BASE_W, availableH / BASE_H);
    const cssW = Math.floor(BASE_W * renderScale);
    const cssH = Math.floor(BASE_H * renderScale);

    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.style.left = `${Math.floor((availableW - cssW) / 2)}px`;
    canvas.style.top = `0px`;

    ctx.setTransform(dpr * renderScale, 0, 0, dpr * renderScale, 0, 0);
    ctx.imageSmoothingEnabled = true;
}

const terminalModal = document.getElementById("terminal-modal");
const terminalOutput = document.getElementById("terminal-output");
const terminalInput = document.getElementById("terminal-input");
const terminalRun = document.getElementById("terminal-run");
const openTerminalButton = document.getElementById("open-terminal");
const closeTerminalButton = document.getElementById("terminal-close");
let terminalHistory = [];
let terminalHistoryIndex = -1;
let terminalLastContent = "";

function terminalAtBottom() {
    return terminalOutput.scrollHeight - terminalOutput.scrollTop - terminalOutput.clientHeight < 10;
}

function renderTerminal(force = false) {
    if (!terminalOutput) return;
    const content = os ? os.terminalLines.join("\n") : "";
    if (!force && content === terminalLastContent) return;
    const shouldStick = terminalAtBottom() || terminalLastContent === "";
    terminalOutput.textContent = content;
    terminalLastContent = content;
    if (shouldStick) terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function openTerminal() {
    terminalModal.classList.add("visible");
    renderTerminal(true);
    terminalInput.focus();
}

function closeTerminal() {
    terminalModal.classList.remove("visible");
}

function executeTerminalCommand() {
    const command = terminalInput.value.trim();
    if (!command) return;
    terminalHistory.push(command);
    terminalHistoryIndex = terminalHistory.length;
    terminalInput.value = "";
    os.enqueueCommand(command);
    renderTerminal(true);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

openTerminalButton.addEventListener("click", openTerminal);
closeTerminalButton.addEventListener("click", closeTerminal);
terminalRun.addEventListener("click", executeTerminalCommand);
terminalInput.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Enter") {
        executeTerminalCommand();
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (terminalHistory.length) {
            terminalHistoryIndex = Math.max(0, terminalHistoryIndex - 1);
            terminalInput.value = terminalHistory[terminalHistoryIndex] || "";
            setTimeout(() => terminalInput.setSelectionRange(terminalInput.value.length, terminalInput.value.length), 0);
        }
    } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (terminalHistory.length) {
            terminalHistoryIndex = Math.min(terminalHistory.length, terminalHistoryIndex + 1);
            terminalInput.value = terminalHistory[terminalHistoryIndex] || "";
        }
    }
});

for (const button of document.querySelectorAll(".bottom-bar button[data-command]")) {
    button.addEventListener("click", () => os.enqueueCommand(button.dataset.command));
}

document.addEventListener("keydown", event => {
    if (document.activeElement === terminalInput) return;
    if (event.key === "1") os.enqueueCommand("alg fifo");
    else if (event.key === "2") os.enqueueCommand("alg sjf");
    else if (event.key === "3") os.enqueueCommand("alg rr");
    else if (event.key === "4") os.enqueueCommand("alg prio");
    else if (event.key.toLowerCase() === "n") os.enqueueCommand("create");
    else if (event.key.toLowerCase() === "m") os.enqueueCommand("mutex");
    else if (event.key.toLowerCase() === "d") os.enqueueCommand("deadlock");
    else if (event.key.toLowerCase() === "r") os.enqueueCommand("resolve");
    else if (event.key === "`") openTerminal();
});

window.addEventListener("resize", resizeCanvas);

os = new SpaceOperatingSystem();
lastTick = performance.now();
resizeCanvas();
renderTerminal(true);
requestAnimationFrame(render);

window.naveOS = os;
