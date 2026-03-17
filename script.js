const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const WIDTH = 1280;
const HEIGHT = 760;
const FPS = 60;

// Colores
const WHITE = '#F0F0F0';
const BLACK = '#0F0F14';
const GRAY = '#64646A';
const LIGHT_GRAY = '#A0A0AA';
const RED = '#DC3C3C';
const GREEN = '#4CE64A';
const BLUE = '#4C8EFF';
const YELLOW = '#FFD028';
const CYAN = '#4CFFDC';
const PURPLE = '#AA4CE6';
const ORANGE = '#FFA028';
const DARK_BLUE = '#1C2832';
const SHIP = '#1E2638';

// Zonas
const battery_zone = { x: 90, y: 180, width: 170, height: 110 };
const tool_zone = { x: 90, y: 440, width: 170, height: 110 };
const corridor_zone = { x: 400, y: 150, width: 220, height: 450 };
const central_panel_zone = { x: 900, y: 270, width: 240, height: 170 };
const critical_zone = { x: 860, y: 230, width: 320, height: 250 };

// Modos
const MODES = {
    1: "CONCURRENCIA",
    2: "SEMAFORO",
    3: "MUTEX",
    4: "MONITOR",
    5: "SECCION CRITICA",
    6: "CONDICION DE CARRERA",
    7: "DEADLOCK",
    8: "SINCRONIZACION"
};

let current_mode = 1;
let running = true;

// Variables compartidas
let panel_lock = false;
let corridor_semaphore = 2;

let race_counter = 0;
let safe_counter = 0;

let battery_lock = false;
let tool_lock = false;

let global_message = "Presiona 1-8 para cambiar el modo";

// Monitor
class SpaceMonitor {
    constructor() {
        this.lock = false;
        this.condition = [];
        this.panel_available = true;
        this.energy_ready = false;
    }

    reset() {
        this.panel_available = true;
        this.energy_ready = false;
        this.condition = [];
    }

    async charge_energy(robot) {
        robot.set_task("Cargando energia");
        await sleep(700);
        this.energy_ready = true;
        this.condition.forEach(resolve => resolve());
        this.condition = [];
    }

    async wait_energy(robot) {
        while (!this.energy_ready && running) {
            robot.set_task("Esperando energia");
            await new Promise(resolve => this.condition.push(resolve));
        }
    }

    async use_panel(robot) {
        while (!this.panel_available && running) {
            robot.set_task("Esperando panel");
            await new Promise(resolve => this.condition.push(resolve));
        }
        this.panel_available = false;

        robot.set_task("Reparando panel");
        await sleep(900);

        this.panel_available = true;
        this.condition.forEach(resolve => resolve());
        this.condition = [];
    }
}

const monitor = new SpaceMonitor();

// Funciones auxiliares
function set_message(text) {
    global_message = text;
    document.getElementById('global-message').textContent = text;
}

function distance(a, b) {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

function zone_center(rect) {
    return [rect.x + rect.width / 2, rect.y + rect.height / 2];
}

function draw_text_center(text, font, color, x, y) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y);
}

function draw_resource(rect, title, color, subtitle = "") {
    ctx.fillStyle = color;
    roundRect(ctx, rect.x, rect.y, rect.width, rect.height, 18);
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 3;
    ctx.stroke();
    // Cambiar tamaño de fuente para "HERRAMIENTAS"
    if (title === "HERRAMIENTAS") {
        ctx.font = '18px Arial';
    } else {
        ctx.font = '24px Arial';
    }
    draw_text_center(title, ctx.font, WHITE, rect.x + rect.width / 2, rect.y + 30);
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class Robot {
    constructor(rid, color, start_pos) {
        this.id = rid;
        this.color = color;
        this.x = start_pos[0];
        this.y = start_pos[1];
        this.start_pos = start_pos;
        this.target = start_pos;
        this.speed = 2.0;
        this.task = "En espera";
        this.alive = true;
        this.flash = 0;
        this.deadlocked = false;
        this.energy = 100;
        this.step_phase = 0;
        this.moving = false;
    }

    async move_to(pos) {
        this.target = pos;
        this.moving = true;
        while (running && this.alive && distance([this.x, this.y], this.target) > 3) {
            const dx = this.target[0] - this.x;
            const dy = this.target[1] - this.y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);

            this.x += this.speed * dx / dist;
            this.y += this.speed * dy / dist;
            this.step_phase += 0.25;
            await sleep(10);
        }
        this.moving = false;
    }

    set_task(task) {
        this.task = task;
    }

    reset_position() {
        this.x = this.start_pos[0];
        this.y = this.start_pos[1];
        this.target = this.start_pos;
        this.task = "Reiniciado";
        this.deadlocked = false;
        this.energy = 100;
        this.flash = 0;
        this.moving = false;
    }

    draw() {
        const x = Math.floor(this.x);
        const y = Math.floor(this.y);

        let body_color = this.color;
        const accent = WHITE;

        if (this.deadlocked) {
            body_color = RED;
        }

        if (this.flash > 0) {
            this.flash--;
            ctx.strokeStyle = YELLOW;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x, y, 42, 0, 2 * Math.PI);
            ctx.stroke();
        }

        const float_offset = Math.floor(3 * Math.abs(Math.sin(this.step_phase * 30 * Math.PI / 180)));

        if (this.task !== "En espera" && this.task !== "Reiniciado") {
            for (let i = 0; i < 3; i++) {
                const jet_x = x - 15 + i * 15;
                const jet_y = y + 35 + float_offset;
                const jet_size = Math.floor(Math.random() * 3) + 2;
                ctx.fillStyle = ORANGE;
                ctx.beginPath();
                ctx.arc(jet_x, jet_y, jet_size, 0, 2 * Math.PI);
                ctx.fill();
                ctx.fillStyle = YELLOW;
                ctx.beginPath();
                ctx.arc(jet_x, jet_y - 2, jet_size - 1, 0, 2 * Math.PI);
                ctx.fill();
            }
        }

        // Helmet
        const helmet = { x: x - 20, y: y - 40 - float_offset, width: 40, height: 35 };
        ctx.fillStyle = '#E0E8F0';
        roundRect(ctx, helmet.x, helmet.y, helmet.width, helmet.height, 10);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Visor
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.ellipse(x - 15, y - 35 - float_offset, 6, 4, 0, 0, 2 * Math.PI);
        ctx.fill();

        const visor = { x: x - 16, y: y - 30 - float_offset, width: 32, height: 20 };
        ctx.fillStyle = '#2D4A6B';
        roundRect(ctx, visor.x, visor.y, visor.width, visor.height, 8);
        ctx.strokeStyle = CYAN;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = CYAN;
        ctx.beginPath();
        ctx.arc(x - 8, y - 20 - float_offset, 2, 0, 2 * Math.PI);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 8, y - 20 - float_offset, 2, 0, 2 * Math.PI);
        ctx.fill();

        // Body
        const body = { x: x - 18, y: y - 8 - float_offset, width: 36, height: 40 };
        ctx.fillStyle = body_color;
        roundRect(ctx, body.x, body.y, body.width, body.height, 10);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Chest panel
        const chest_panel = { x: x - 12, y: y + 2 - float_offset, width: 24, height: 16 };
        ctx.fillStyle = DARK_BLUE;
        roundRect(ctx, chest_panel.x, chest_panel.y, chest_panel.width, chest_panel.height, 4);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Lights
        const light_colors = [GREEN, YELLOW, RED, CYAN];
        for (let i = 0; i < 4; i++) {
            const light_x = x - 8 + i * 6;
            const light_y = y + 6 - float_offset;
            ctx.fillStyle = light_colors[i];
            ctx.beginPath();
            ctx.arc(light_x, light_y, 2, 0, 2 * Math.PI);
            ctx.fill();
        }

        // Arms
        const arm_angle = Math.floor(10 * Math.abs(Math.sin(this.step_phase * 25 * Math.PI / 180)));
        ctx.strokeStyle = body_color;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x - 18, y + 5 - float_offset);
        ctx.lineTo(x - 28, y + 18 + arm_angle);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 18, y + 5 - float_offset);
        ctx.lineTo(x + 28, y + 18 - arm_angle);
        ctx.stroke();

        ctx.fillStyle = '#9696A0';
        ctx.beginPath();
        ctx.arc(x - 28, y + 18 + arm_angle, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 28, y + 18 - arm_angle, 4, 0, 2 * Math.PI);
        ctx.fill();

        // Legs
        const leg_offset = Math.floor(8 * Math.abs(Math.sin(this.step_phase * 40 * Math.PI / 180)));
        ctx.strokeStyle = body_color;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x - 10, y + 32 - float_offset);
        ctx.lineTo(x - 12, y + 45 + leg_offset);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 10, y + 32 - float_offset);
        ctx.lineTo(x + 12, y + 45 - leg_offset);
        ctx.stroke();

        const boot_left = { x: x - 18, y: y + 43 + leg_offset, width: 12, height: 8 };
        const boot_right = { x: x + 6, y: y + 43 - leg_offset, width: 12, height: 8 };
        ctx.fillStyle = '#64646A';
        roundRect(ctx, boot_left.x, boot_left.y, boot_left.width, boot_left.height, 3);
        roundRect(ctx, boot_right.x, boot_right.y, boot_right.width, boot_right.height, 3);

        // Tank
        const tank = { x: x - 22, y: y + 5 - float_offset, width: 8, height: 20 };
        ctx.fillStyle = '#C0C0D0';
        roundRect(ctx, tank.x, tank.y, tank.width, tank.height, 4);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Energy bar
        const bar_w = 40;
        const bar_h = 6;
        const bar_x = x - 20;
        const bar_y = y - 70 - float_offset;
        ctx.fillStyle = '#14141E';
        roundRect(ctx, bar_x, bar_y, bar_w, bar_h, 3);
        const fill = Math.max(0, Math.min(bar_w, Math.floor((this.energy / 100) * bar_w)));
        let energy_color = GREEN;
        if (this.energy > 60) energy_color = GREEN;
        else if (this.energy > 30) energy_color = YELLOW;
        else energy_color = RED;
        ctx.fillStyle = energy_color;
        roundRect(ctx, bar_x, bar_y, fill, bar_h, 3);
        ctx.strokeStyle = CYAN;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Label
        ctx.font = '18px Arial';
        ctx.fillStyle = CYAN;
        ctx.textAlign = 'center';
        ctx.fillText(`A${this.id}`, x - 12, y + 50);

        // Task background
        const task_bg = { x: x - 70, y: y + 62, width: 140, height: 22 };
        ctx.fillStyle = '#0A0A14';
        roundRect(ctx, task_bg.x, task_bg.y, task_bg.width, task_bg.height, 11);
        ctx.strokeStyle = CYAN;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Task text
        ctx.font = '14px Arial';
        ctx.fillStyle = WHITE;
        ctx.fillText(this.task.substring(0, 15), x - 65, y + 67);
    }
}

function draw_ship_background() {
    ctx.fillStyle = '#05080C';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Animated starfield
    for (let i = 0; i < 150; i++) {
        const sx = Math.floor(Math.random() * WIDTH);
        const sy = Math.floor(Math.random() * HEIGHT);
        const brightness = Math.floor(Math.random() * 156) + 100;
        const size = Math.floor(Math.random() * 3) + 1;
        ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${Math.min(255, brightness + 25)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, 2 * Math.PI);
        ctx.fill();
    }

    // Nebula effect
    for (let i = 0; i < 3; i++) {
        const nx = Math.floor(Math.random() * 800) + 200;
        const ny = Math.floor(Math.random() * 400) + 150;
        for (let r = 80; r > 20; r -= 10) {
            const alpha = 20 - (80 - r) / 4;
            ctx.fillStyle = `rgba(${120 + i * 30}, ${80}, ${150 + i * 20}, ${alpha / 255})`;
            ctx.beginPath();
            ctx.arc(nx, ny, r, 0, 2 * Math.PI);
            ctx.fill();
        }
    }

    const hull = { x: 35, y: 110, width: 1210, height: 600 };
    ctx.fillStyle = '#19233F';
    roundRect(ctx, hull.x, hull.y, hull.width, hull.height, 40);
    ctx.strokeStyle = '#283858';
    ctx.lineWidth = 3;
    ctx.stroke();

    for (let i = 0; i < 8; i++) {
        const panel_x = 80 + i * 140;
        const panel = { x: panel_x, y: 140, width: 120, height: 450 };
        ctx.fillStyle = '#23354F';
        roundRect(ctx, panel.x, panel.y, panel.width, panel.height, 15);
        ctx.strokeStyle = '#3C4A70';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    for (let i = 0; i < 6; i++) {
        const wx = 320 + i * 100;
        const wy = 130;
        // Window frame
        ctx.fillStyle = '#6470A0';
        roundRect(ctx, wx, wy, 60, 30, 15);
        ctx.strokeStyle = WHITE;
        ctx.lineWidth = 2;
        ctx.stroke();
        // Glass reflection
        ctx.fillStyle = '#96C8FF';
        roundRect(ctx, wx + 5, wy + 5, 20, 10, 5);
    }

    ctx.fillStyle = '#233557';
    roundRect(ctx, corridor_zone.x, corridor_zone.y, corridor_zone.width, corridor_zone.height, 25);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Corridor lighting strips
    for (let i = 0; i < 5; i++) {
        const light_y = corridor_zone.y + 20 + i * 85;
        ctx.strokeStyle = YELLOW;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(corridor_zone.x + 10, light_y);
        ctx.lineTo(corridor_zone.x + corridor_zone.width - 10, light_y);
        ctx.stroke();
    }

    draw_resource(battery_zone, "ENERGIA", BLUE);
    draw_resource(tool_zone, "HERRAMIENTAS", ORANGE);
    draw_resource(central_panel_zone, "PANEL CENTRAL", PURPLE);

    ctx.strokeStyle = '#FF6464';
    ctx.lineWidth = 4;
    roundRect(ctx, critical_zone.x, critical_zone.y, critical_zone.width, critical_zone.height, 25);
    ctx.strokeStyle = '#401414';
    ctx.lineWidth = 2;
    roundRect(ctx, critical_zone.x, critical_zone.y, critical_zone.width, critical_zone.height, 25);

    for (let i = 0; i < 3; i++) {
        const vent_x = 600 + i * 200;
        const vent_y = 180;
        ctx.fillStyle = '#46506E';
        roundRect(ctx, vent_x, vent_y, 80, 20, 10);
        for (let j = 0; j < 4; j++) {
            ctx.strokeStyle = '#2D3447';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(vent_x + 10 + j * 18, vent_y + 5);
            ctx.lineTo(vent_x + 10 + j * 18, vent_y + 15);
            ctx.stroke();
        }
    }

    ctx.fillStyle = YELLOW;
    ctx.beginPath();
    ctx.moveTo(corridor_zone.x - 30, corridor_zone.y + corridor_zone.height / 2);
    ctx.lineTo(corridor_zone.x - 10, corridor_zone.y + corridor_zone.height / 2 - 15);
    ctx.lineTo(corridor_zone.x - 10, corridor_zone.y + corridor_zone.height / 2 + 15);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(corridor_zone.x + corridor_zone.width + 30, corridor_zone.y + corridor_zone.height / 2);
    ctx.lineTo(corridor_zone.x + corridor_zone.width + 10, corridor_zone.y + corridor_zone.height / 2 - 15);
    ctx.lineTo(corridor_zone.x + corridor_zone.width + 10, corridor_zone.y + corridor_zone.height / 2 + 15);
    ctx.closePath();
    ctx.fill();
}

function draw_ui(mode_name) {
    // Title removed as requested
    // Mode panel
    document.getElementById('current-mode').textContent = mode_name;

    // Status is in HTML
}

function draw_counters() {
    document.getElementById('race-counter').textContent = `Race: ${race_counter}`;
    document.getElementById('safe-counter').textContent = `Safe: ${safe_counter}`;

    const percentage = safe_counter > 0 ? Math.floor((race_counter / safe_counter) * 100) : 0;
    document.getElementById('percentage').textContent = `${percentage}%`;
    document.getElementById('progress-fill').style.width = `${Math.min(percentage, 100)}%`;
}

function draw_panel_sparks() {
    if ([3, 4, 5, 8].includes(current_mode)) {
        for (let i = 0; i < 8; i++) {
            const px = Math.floor(Math.random() * 200) + central_panel_zone.x + 20;
            const py = Math.floor(Math.random() * 120) + central_panel_zone.y + 20;

            const spark_length = Math.floor(Math.random() * 8) + 8;
            const spark_color = [YELLOW, WHITE, CYAN, '#FFCC66'][Math.floor(Math.random() * 4)];

            ctx.strokeStyle = spark_color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + Math.floor(Math.random() * spark_length * 2) - spark_length, py + Math.floor(Math.random() * spark_length * 2) - spark_length);
            ctx.stroke();

            if (Math.random() > 0.6) {
                const branch_x = px + Math.floor(Math.random() * 10) - 5;
                const branch_y = py + Math.floor(Math.random() * 10) - 5;
                ctx.strokeStyle = WHITE;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(branch_x, branch_y);
                ctx.lineTo(branch_x + Math.floor(Math.random() * 12) - 6, branch_y + Math.floor(Math.random() * 12) - 6);
                ctx.stroke();
            }

            ctx.fillStyle = spark_color;
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
}

function draw_deadlock_alert() {
    if (current_mode === 7) {
        const alert_box = { x: 450, y: 110, width: 380, height: 45 };
        ctx.fillStyle = RED;
        roundRect(ctx, alert_box.x, alert_box.y, alert_box.width, alert_box.height, 10);
        ctx.strokeStyle = WHITE;
        ctx.lineWidth = 2;
        ctx.stroke();

        const pulse = Math.abs(Math.sin(Date.now() / 500));
        const alert_color = `rgb(${255}, ${Math.floor(100 + 155 * pulse)}, ${Math.floor(100 + 155 * pulse)})`;
        draw_text_center("ALERTA: POSIBLE DEADLOCK ENTRE RECURSOS", '24px Arial', alert_color, alert_box.x + alert_box.width / 2, alert_box.y + alert_box.height / 2 + 8);

        for (let i = 0; i < 3; i++) {
            const triangle_x = alert_box.x + 20 + i * 120;
            const triangle_y = alert_box.y + alert_box.height / 2;
            ctx.fillStyle = YELLOW;
            ctx.beginPath();
            ctx.moveTo(triangle_x, triangle_y - 8);
            ctx.lineTo(triangle_x - 6, triangle_y + 4);
            ctx.lineTo(triangle_x + 6, triangle_y + 4);
            ctx.closePath();
            ctx.fill();
        }
    }
}

function draw_energy_effects() {
    if ([1, 2, 3, 4, 5, 8].includes(current_mode)) {
        for (let i = 0; i < 3; i++) {
            const px = Math.floor(Math.random() * battery_zone.width) + battery_zone.x;
            const py = Math.floor(Math.random() * battery_zone.height) + battery_zone.y;
            ctx.fillStyle = '#6496FF';
            ctx.beginPath();
            ctx.arc(px, py, Math.floor(Math.random() * 3) + 1, 0, 2 * Math.PI);
            ctx.fill();

            const trail_x = px + Math.floor(Math.random() * 20) - 10;
            const trail_y = py + Math.floor(Math.random() * 20) - 10;
            ctx.strokeStyle = '#4064C8';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(trail_x, trail_y);
            ctx.stroke();
        }

        for (let i = 0; i < 2; i++) {
            const px = Math.floor(Math.random() * 200) + central_panel_zone.x + 20;
            const py = Math.floor(Math.random() * 120) + central_panel_zone.y + 20;
            ctx.strokeStyle = YELLOW;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + Math.floor(Math.random() * 12) - 6, py + Math.floor(Math.random() * 12) - 6);
            ctx.stroke();
        }
    }
}

// Modos de ejecución
async function mode_concurrency(robot) {
    set_message("CONCURRENCIA: varios robots avanzan al mismo tiempo");
    robot.set_task("Inspeccionando");
    robot.energy = Math.max(40, robot.energy - 1);
    await robot.move_to([Math.floor(Math.random() * 280) + 330, Math.floor(Math.random() * 320) + 180]);
    robot.set_task("Moviendose");
    await robot.move_to(zone_center(central_panel_zone));
    robot.set_task("Revisando panel");
    robot.flash = 10;
    await sleep(500);
    await robot.move_to([Math.floor(Math.random() * 360) + 300, Math.floor(Math.random() * 340) + 160]);
    await sleep(200);
}

async function mode_semaphore(robot) {
    set_message("SEMAFORO: solo 2 robots pueden entrar al corredor tecnico");
    await robot.move_to([330, 220 + robot.id * 70]);
    robot.set_task("Esperando corredor");

    while (corridor_semaphore <= 0 && running) {
        await sleep(100);
    }
    corridor_semaphore--;

    robot.set_task("En corredor");
    robot.flash = 12;
    await robot.move_to(zone_center(corridor_zone));
    await sleep(900);
    await robot.move_to([700, 230 + robot.id * 55]);
    robot.set_task("Salio del corredor");
    corridor_semaphore++;
    await sleep(300);
}

async function mode_mutex(robot) {
    set_message("MUTEX: solo un robot puede usar el panel central");
    await robot.move_to([820, 300 + robot.id * 20]);
    robot.set_task("Esperando panel");

    while (panel_lock && running) {
        await sleep(100);
    }
    panel_lock = true;

    robot.flash = 15;
    await robot.move_to(zone_center(central_panel_zone));
    robot.set_task("Usando panel (mutex)");
    robot.energy = Math.max(30, robot.energy - 3);
    await sleep(1000);

    panel_lock = false;
    robot.set_task("Panel liberado");
    await robot.move_to([760, 170 + robot.id * 80]);
    await sleep(200);
}

async function mode_monitor(robot) {
    set_message("MONITOR: una clase controla energia y panel de forma segura");
    await robot.move_to(zone_center(battery_zone));
    await monitor.charge_energy(robot);
    robot.energy = 100;
    await monitor.wait_energy(robot);
    await robot.move_to(zone_center(central_panel_zone));
    await monitor.use_panel(robot);
    robot.flash = 12;
    await robot.move_to([760, 170 + robot.id * 80]);
    robot.set_task("Ciclo monitor completo");
    await sleep(300);
}

async function mode_critical_section(robot) {
    set_message("SECCION CRITICA: solo un robot entra al modulo central");
    await robot.move_to([820, 260 + robot.id * 30]);
    robot.set_task("Esperando seccion critica");

    while (panel_lock && running) {
        await sleep(100);
    }
    panel_lock = true;

    robot.flash = 16;
    await robot.move_to([critical_zone.x + critical_zone.width / 2, critical_zone.y + critical_zone.height / 2]);
    robot.set_task("Dentro de seccion critica");
    await sleep(1100);

    panel_lock = false;
    robot.set_task("Salio de zona critica");
    await robot.move_to([760, 170 + robot.id * 80]);
    await sleep(200);
}

async function mode_race_condition(robot) {
    set_message("CONDICION DE CARRERA: un contador falla sin control");
    await robot.move_to(zone_center(central_panel_zone));

    robot.set_task("Actualizando SIN control");
    let local = race_counter;
    await sleep(Math.random() * 70 + 10);
    local += 1;
    race_counter = local;

    robot.set_task("Actualizando CON lock");
    while (panel_lock && running) {
        await sleep(10);
    }
    panel_lock = true;
    let temp = safe_counter;
    await sleep(Math.random() * 70 + 10);
    temp += 1;
    safe_counter = temp;
    panel_lock = false;

    robot.flash = 10;
    await robot.move_to([760, 170 + robot.id * 80]);
    await sleep(250);
}

async function mode_deadlock(robot) {
    set_message("DEADLOCK: robots bloqueados esperando recursos entre si");

    if (robot.id % 2 === 0) {
        await robot.move_to(zone_center(battery_zone));
        robot.set_task("Tomando bateria");
        while (battery_lock && running) {
            await sleep(100);
        }
        battery_lock = true;
        await sleep(400);

        await robot.move_to(zone_center(tool_zone));
        robot.set_task("Espera herramienta");
        let timeout = 1500;
        while (tool_lock && timeout > 0 && running) {
            await sleep(100);
            timeout -= 100;
        }
        if (!tool_lock) {
            tool_lock = true;
            robot.set_task("Consiguio ambos recursos");
            await sleep(600);
            tool_lock = false;
            battery_lock = false;
        } else {
            robot.set_task("DEADLOCK");
            robot.deadlocked = true;
            robot.flash = 30;
            await sleep(1200);
            battery_lock = false;
        }

    } else {
        await robot.move_to(zone_center(tool_zone));
        robot.set_task("Tomando herramienta");
        while (tool_lock && running) {
            await sleep(100);
        }
        tool_lock = true;
        await sleep(400);

        await robot.move_to(zone_center(battery_zone));
        robot.set_task("Espera bateria");
        let timeout = 1500;
        while (battery_lock && timeout > 0 && running) {
            await sleep(100);
            timeout -= 100;
        }
        if (!battery_lock) {
            battery_lock = true;
            robot.set_task("Consiguio ambos recursos");
            await sleep(600);
            battery_lock = false;
            tool_lock = false;
        } else {
            robot.set_task("DEADLOCK");
            robot.deadlocked = true;
            robot.flash = 30;
            await sleep(1200);
            tool_lock = false;
        }
    }

    await robot.move_to([760, 170 + robot.id * 80]);
    await sleep(200);
}

async function mode_synchronization(robot) {
    set_message("SINCRONIZACION: primero energia, luego traslado y finalmente reparacion");
    await robot.move_to(zone_center(battery_zone));
    robot.set_task("Cargando sistema");
    robot.energy = 100;
    await sleep(700);

    await robot.move_to(zone_center(corridor_zone));
    robot.set_task("Traslado sincronizado");
    await sleep(500);

    while (panel_lock && running) {
        await sleep(100);
    }
    panel_lock = true;
    await robot.move_to(zone_center(central_panel_zone));
    robot.set_task("Reparacion final");
    robot.flash = 12;
    await sleep(1000);
    panel_lock = false;

    robot.set_task("Secuencia correcta");
    await robot.move_to([760, 170 + robot.id * 80]);
    await sleep(200);
}

// Loop de cada robot
async function robot_loop(robot) {
    while (running && robot.alive) {
        const mode = current_mode;

        try {
            if (mode === 1) await mode_concurrency(robot);
            else if (mode === 2) await mode_semaphore(robot);
            else if (mode === 3) await mode_mutex(robot);
            else if (mode === 4) await mode_monitor(robot);
            else if (mode === 5) await mode_critical_section(robot);
            else if (mode === 6) await mode_race_condition(robot);
            else if (mode === 7) await mode_deadlock(robot);
            else if (mode === 8) await mode_synchronization(robot);
            else await sleep(100);
        } catch (e) {
            robot.set_task("Error");
            set_message(`Error en robot ${robot.id}: ${e}`);
            await sleep(500);
        }
    }
}

// Creación de robots
const start_positions = [
    [320, 200],
    [320, 320],
    [320, 440],
    [320, 560]
];

const robots = [
    new Robot(1, RED, start_positions[0]),
    new Robot(2, GREEN, start_positions[1]),
    new Robot(3, CYAN, start_positions[2]),
    new Robot(4, YELLOW, start_positions[3]),
];

// Reinicio
function reset_all() {
    race_counter = 0;
    safe_counter = 0;

    robots.forEach(robot => robot.reset_position());

    monitor.reset();
    panel_lock = false;
    corridor_semaphore = 2;
    battery_lock = false;
    tool_lock = false;
    set_message("Estado reiniciado");
}

// Bucle principal
function main_loop() {
    draw_ship_background();
    draw_ui(MODES[current_mode]);
    draw_counters();
    draw_deadlock_alert();
    draw_panel_sparks();
    draw_energy_effects();

    if (current_mode === 2) {
        ctx.strokeStyle = CYAN;
        ctx.lineWidth = 4;
        roundRect(ctx, corridor_zone.x, corridor_zone.y, corridor_zone.width, corridor_zone.height, 20);
    }

    if (current_mode === 7) {
        ctx.strokeStyle = RED;
        ctx.lineWidth = 4;
        roundRect(ctx, battery_zone.x, battery_zone.y, battery_zone.width, battery_zone.height, 18);
        roundRect(ctx, tool_zone.x, tool_zone.y, tool_zone.width, tool_zone.height, 18);
    }

    if ([3, 5, 8].includes(current_mode)) {
        ctx.strokeStyle = YELLOW;
        ctx.lineWidth = 4;
        roundRect(ctx, critical_zone.x, critical_zone.y, critical_zone.width, critical_zone.height, 20);
    }

    robots.forEach(robot => robot.draw());

    if (running) {
        requestAnimationFrame(main_loop);
    }
}

// Iniciar
robots.forEach(robot => robot_loop(robot));

main_loop();

// Funciones globales
window.changeMode = function(mode) {
    current_mode = mode;
    reset_all();
};

window.resetAll = reset_all;

// Teclado
document.addEventListener('keydown', (event) => {
    if (event.key >= '1' && event.key <= '8') {
        changeMode(parseInt(event.key));
    } else if (event.key === 'r' || event.key === 'R') {
        reset_all();
    }
});
