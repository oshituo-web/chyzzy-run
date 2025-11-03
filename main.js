import * as THREE from 'three';

// =========== CONSTANTS ===========
const BASE_SPEED = 0.15;
const ROAD_LENGTH = 200;
const INVINCIBILITY_DURATION = 1500; // 1.5 seconds
const SCORE_MULTIPLIER_DURATION = 10000; // 10 seconds

// =========== SCENE SETUP ===========
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87CEEB, 1, 200);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10); // Adjusted camera for a better view
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas') });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// =========== SKYBOX ===========
const skyboxGeometry = new THREE.BoxGeometry(1000, 1000, 1000);
const skyboxMaterial = new THREE.ShaderMaterial({
    vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
            vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
    `,
    fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
            float h = normalize( vWorldPosition + offset ).y;
            gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max( h , 0.0), exponent ), 0.0 ) ), 1.0 );
        }
    `,
    uniforms: {
        topColor: { value: new THREE.Color(0x0077ff) },
        bottomColor: { value: new THREE.Color(0xffffff) },
        offset: { value: 33 },
        exponent: { value: 0.6 }
    },
    side: THREE.BackSide
});
const skybox = new THREE.Mesh(skyboxGeometry, skyboxMaterial);
scene.add(skybox);


// =========== AUDIO ===========
const synth = new Tone.Synth().toDestination();
const bgm = new Tone.Loop(time => {
    synth.triggerAttackRelease("C2", "8n", time);
    synth.triggerAttackRelease("G2", "8n", time + Tone.Time("8n"));
}, "4n").start(0);

const sfx = {
    switch: () => new Tone.Synth().toDestination().triggerAttackRelease("C4", "16n"),
    powerup: () => new Tone.Synth().toDestination().triggerAttackRelease("E5", "8n"),
    collision: () => new Tone.Synth().toDestination().triggerAttackRelease("C3", "8n"),
    gameOver: () => new Tone.Synth().toDestination().triggerAttackRelease("C2", "1n"),
    jump: () => new Tone.Synth().toDestination().triggerAttackRelease("A4", "16n"),
};

// =========== LIGHTING ===========
const hemisphereLight = new THREE.HemisphereLight(0xFFFFBB, 0x080820, 1);
scene.add(hemisphereLight);

const directionalLight = new THREE.DirectionalLight(0xFFFFFF, 0.8);
directionalLight.position.set(0, 10, 5);
scene.add(directionalLight);

// =========== ROAD ===========
const roadGeometry = new THREE.PlaneGeometry(30, ROAD_LENGTH);
const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });

const road1 = new THREE.Mesh(roadGeometry, roadMaterial);
road1.rotation.x = -Math.PI / 2;
road1.position.y = -0.5;
road1.position.z = -ROAD_LENGTH / 2;
scene.add(road1);

const road2 = new THREE.Mesh(roadGeometry, roadMaterial);
road2.rotation.x = -Math.PI / 2;
road2.position.y = -0.5;
road2.position.z = -ROAD_LENGTH * 1.5;
scene.add(road2);

const roads = [road1, road2];

// =========== PLAYER ===========
function createPlayer() {
    const player = new THREE.Group();

    const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 32, 32),
        new THREE.MeshStandardMaterial({ color: 0xE0AC69 })
    );
    head.position.y = 2.5;
    player.add(head);

    const torso = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1.5, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xFF0000 })
    );
    torso.position.y = 1.25;
    player.add(torso);

    const leftArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.1, 1.2, 32),
        new THREE.MeshStandardMaterial({ color: 0xE0AC69 })
    );
    leftArm.position.set(-0.7, 1.8, 0);
    player.add(leftArm);

    const rightArm = leftArm.clone();
    rightArm.position.x = 0.7;
    player.add(rightArm);

    const leftLeg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.15, 1.5, 32),
        new THREE.MeshStandardMaterial({ color: 0x0000FF })
    );
    leftLeg.position.set(-0.3, 0, 0);
    player.add(leftLeg);

    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.3;
    player.add(rightLeg);

    player.position.y = 0.5;
    scene.add(player);
    return player;
}

const player = createPlayer();

// =========== PLAYER STATE & MOVEMENT ===========
const LANE_WIDTH = 5;
const lanes = [-LANE_WIDTH, 0, LANE_WIDTH];

let gameSpeed = BASE_SPEED;

const playerState = {
    currentLaneIndex: 1, // 0: Left, 1: Center, 2: Right
    targetX: 0,
    isSwitching: false, // To prevent multiple inputs during a switch
    isInvincible: false,
    shieldCount: 0,
    score: 0,
    scoreMultiplier: 1.0,
    speedMultiplier: 1.0,
    nextSpeedBoostScore: 5000,
    isAlive: true,
    isPaused: false,
    isJumping: false,
    isFalling: false,
    isGliding: false,
    isOnObstacle: false,
    isSliding: false,
    yVelocity: 0,
    level: 1,
    lastLevelUpTime: 0,
    currentRoadIndex: 0,
    nextJunctionScore: 10000,
    atJunction: false,
};

const JUMP_POWER = 0.4;
const HIGH_JUMP_POWER = 0.55;
const GRAVITY = -0.02;

const scoreElement = document.getElementById('score');
const shieldElement = document.getElementById('shield-count');
const startScreen = document.getElementById('start-screen');
const startButton = document.getElementById('start-button');
const gameOverScreen = document.getElementById('game-over-screen');
const finalScoreElement = document.getElementById('final-score');
const restartButton = document.getElementById('restart-button');
const pauseButton = document.getElementById('pause-button');
const highScoreElement = document.getElementById('high-score');
const levelElement = document.getElementById('level');
const powerupNotificationElement = document.getElementById('powerup-notification');
const roadNameElement = document.getElementById('road-name');

const roadNames = ["Third Mainland Bridge", "Lekki-Epe Expressway", "Ikorodu Road", "Agege Motor Road", "Ozumba Mbadiwe Avenue"];

let touchStartX = 0;
let touchStartY = 0;
let lastTap = 0;

function handleKeyPress(event) {
    if (playerState.isSwitching || !playerState.isAlive) return;

    if (event.key === 'a' || event.key === 'ArrowLeft') {
        moveLeft();
    } else if (event.key === 'd' || event.key === 'ArrowRight') {
        moveRight();
    } else if (event.key === ' ' || event.key === 'w' || event.key === 'ArrowUp') {
        jump();
    } else if (event.key === 's' || event.key === 'ArrowDown') {
        slide();
    }
}

function moveLeft() {
    if (playerState.isSwitching || !playerState.isAlive) return;
    if (playerState.atJunction) {
        switchRoad();
    }
    let targetLaneIndex = Math.max(0, playerState.currentLaneIndex - 1);
    if (targetLaneIndex !== playerState.currentLaneIndex) {
        sfx.switch();
        playerState.currentLaneIndex = targetLaneIndex;
        playerState.targetX = lanes[targetLaneIndex];
        playerState.isSwitching = true;
    }
}

function moveRight() {
    if (playerState.isSwitching || !playerState.isAlive) return;
    if (playerState.atJunction) {
        switchRoad();
    }
    let targetLaneIndex = Math.min(2, playerState.currentLaneIndex + 1);
    if (targetLaneIndex !== playerState.currentLaneIndex) {
        sfx.switch();
        playerState.currentLaneIndex = targetLaneIndex;
        playerState.targetX = lanes[targetLaneIndex];
        playerState.isSwitching = true;
    }
}

function jump() {
    if (!playerState.isJumping && playerState.isAlive) {
        sfx.jump();
        playerState.isJumping = true;
        playerState.yVelocity = JUMP_POWER;
    }
}

function highJump() {
    if (!playerState.isJumping && playerState.isAlive) {
        sfx.jump();
        playerState.isJumping = true;
        playerState.isGliding = true;
        playerState.yVelocity = HIGH_JUMP_POWER;
        setTimeout(() => {
            playerState.isGliding = false;
        }, 2000); // 2 seconds of gliding
    }
}

function slide() {
    if (!playerState.isJumping && !playerState.isSliding && playerState.isAlive) {
        playerState.isSliding = true;
        setTimeout(() => {
            playerState.isSliding = false;
        }, 1000); // 1 second of sliding
    }
}

function handleTouchStart(event) {
    touchStartX = event.changedTouches[0].screenX;
    touchStartY = event.changedTouches[0].screenY;
}

function handleTouchEnd(event) {
    const touchEndX = event.changedTouches[0].screenX;
    const touchEndY = event.changedTouches[0].screenY;

    const swipeDistanceX = touchEndX - touchStartX;
    const swipeDistanceY = touchEndY - touchStartY;

    if (Math.abs(swipeDistanceX) < 10 && Math.abs(swipeDistanceY) < 10) {
        // It's a tap
        const currentTime = new Date().getTime();
        const timeSinceLastTap = currentTime - lastTap;
        if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
            // Double tap
            highJump();
        } else {
            // Single tap
            jump();
        }
        lastTap = currentTime;
    } else if (Math.abs(swipeDistanceY) > Math.abs(swipeDistanceX)) {
        // Vertical swipe
        if (swipeDistanceY > 50) {
            slide();
        }
    } else {
        // Horizontal swipe
        if (swipeDistanceX < -50) {
            moveLeft();
        } else if (swipeDistanceX > 50) {
            moveRight();
        }
    }
}

function togglePause() {
    playerState.isPaused = !playerState.isPaused;
    if (playerState.isPaused) {
        Tone.Transport.pause();
        pauseButton.textContent = 'Play';
    } else {
        Tone.Transport.start();
        pauseButton.textContent = 'Pause';
        animate(); // Resume animation
    }
}

document.addEventListener('keydown', handleKeyPress);
renderer.domElement.addEventListener('touchstart', handleTouchStart, false);
renderer.domElement.addEventListener('touchend', handleTouchEnd, false);

startButton.addEventListener('click', startGame);
restartButton.addEventListener('click', restartGame);
pauseButton.addEventListener('click', togglePause);

// =========== BUILDING GENERATION ===========
const BUILDING_POOL_SIZE = 30;
const BUILDING_WIDTH = 15;
const BUILDING_DEPTH = 15;
const BUILDING_MIN_HEIGHT = 10;
const BUILDING_MAX_HEIGHT = 50;
const BUILDING_SPACING = 5;

const buildingColors = [
    [0xFFC300, 0xFF5733, 0xC70039, 0x900C3F, 0x581845], // Theme 1
    [0x1E8449, 0x2ECC71, 0x27AE60, 0x229954, 0x1D8348], // Theme 2 (Greens)
    [0x2874A6, 0x3498DB, 0x5DADE2, 0x85C1E9, 0xAED6F1], // Theme 3 (Blues)
    [0x6C3483, 0x8E44AD, 0xA569BD, 0xBB8FCE, 0xD7BDE2], // Theme 4 (Purples)
    [0xB7950B, 0xD4AC0D, 0F1C40F, 0F39C12, 0xCA6F1E]  // Theme 5 (Browns/Oranges)
];
let currentBuildingColors = buildingColors[0];
const buildingGeometry = new THREE.BoxGeometry(BUILDING_WIDTH, 1, BUILDING_DEPTH);

function createBuilding(side, z) {
    const height = THREE.MathUtils.randInt(BUILDING_MIN_HEIGHT, BUILDING_MAX_HEIGHT);
    const color = currentBuildingColors[THREE.MathUtils.randInt(0, currentBuildingColors.length - 1)];
    const material = new THREE.MeshStandardMaterial({ color });

    const building = new THREE.Mesh(buildingGeometry, material);
    building.scale.y = height;
    building.position.y = height / 2 - 0.5;
    building.position.x = side * (LANE_WIDTH + BUILDING_WIDTH / 2 + BUILDING_SPACING);
    building.position.z = z;

    scene.add(building);
    return building;
}

const leftBuildings = [];
const rightBuildings = [];

for (let i = 0; i < BUILDING_POOL_SIZE; i++) {
    const z = -i * (BUILDING_DEPTH + BUILDING_SPACING) - ROAD_LENGTH / 2;
    leftBuildings.push(createBuilding(-1, z));
    rightBuildings.push(createBuilding(1, z));
}

const allBuildings = [...leftBuildings, ...rightBuildings];

// =========== JUNCTION GENERATION ===========
const junctions = [];

function createArrow() {
    const arrow = new THREE.Group();
    const head = new THREE.Mesh(
        new THREE.ConeGeometry(2, 4, 4),
        new THREE.MeshStandardMaterial({ color: 0x00FF00 })
    );
    head.rotation.z = Math.PI / 2;
    arrow.add(head);

    const shaft = new THREE.Mesh(
        new THREE.BoxGeometry(4, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x00FF00 })
    );
    shaft.position.x = -3;
    arrow.add(shaft);

    arrow.visible = false;
    scene.add(arrow);
    return arrow;
}

for (let i = 0; i < 2; i++) { // Only need 2 arrows for a junction
    junctions.push(createArrow());
}

function spawnJunction() {
    playerState.atJunction = true;
    const arrowLeft = junctions[0];
    const arrowRight = junctions[1];

    arrowLeft.position.set(-LANE_WIDTH - 5, 3, OBSTACLE_SPAWN_Z + 50);
    arrowLeft.rotation.y = 0;
    arrowLeft.visible = true;

    arrowRight.position.set(LANE_WIDTH + 5, 3, OBSTACLE_SPAWN_Z + 50);
    arrowRight.rotation.y = Math.PI;
    arrowRight.visible = true;

    playerState.nextJunctionScore += 10000; // Set score for next junction
}

function switchRoad() {
    playerState.atJunction = false;
    junctions.forEach(j => j.visible = false);

    playerState.currentRoadIndex = (playerState.currentRoadIndex + 1) % roadNames.length;
    roadNameElement.textContent = roadNames[playerState.currentRoadIndex];
    currentBuildingColors = buildingColors[playerState.currentRoadIndex];

    // Refresh building colors
    allBuildings.forEach(building => {
        const color = currentBuildingColors[THREE.MathUtils.randInt(0, currentBuildingColors.length - 1)];
        building.material.color.set(color);
    });
}

// =========== POWER-UP GENERATION ===========
const shawarmaGeometry = new THREE.TorusGeometry(0.8, 0.3, 16, 100);
const shawarmaMaterial = new THREE.MeshStandardMaterial({ color: 0xFFD700 }); // Gold color
const shawarma = new THREE.Mesh(shawarmaGeometry, shawarmaMaterial);
shawarma.position.y = 1;
shawarma.visible = false;
scene.add(shawarma);

const sachetWaterGeometry = new THREE.BoxGeometry(1, 1, 1);
const sachetWaterMaterial = new THREE.MeshStandardMaterial({ color: 0xADD8E6, transparent: true, opacity: 0.8 }); // Light blue
const sachetWater = new THREE.Mesh(sachetWaterGeometry, sachetWaterMaterial);
sachetWater.position.y = 1;
sachetWater.visible = false;
scene.add(sachetWater);

const energyDrinkGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1.5, 32);
const energyDrinkMaterial = new THREE.MeshStandardMaterial({ color: 0x00FF00 }); // Green color
const energyDrink = new THREE.Mesh(energyDrinkGeometry, energyDrinkMaterial);
energyDrink.position.y = 1;
energyDrink.visible = false;
scene.add(energyDrink);

const speedBoost2xGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1.5, 32);
const speedBoost2xMaterial = new THREE.MeshStandardMaterial({ color: 0xFFA500 }); // Orange
const speedBoost2x = new THREE.Mesh(speedBoost2xGeometry, speedBoost2xMaterial);
speedBoost2x.position.y = 1;
speedBoost2x.visible = false;
scene.add(speedBoost2x);

const speedBoost5xGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1.5, 32);
const speedBoost5xMaterial = new THREE.MeshStandardMaterial({ color: 0x8A2BE2 }); // BlueViolet
const speedBoost5x = new THREE.Mesh(speedBoost5xGeometry, speedBoost5xMaterial);
speedBoost5x.position.y = 1;
speedBoost5x.visible = false;
scene.add(speedBoost5x);

function spawnShawarma() {
    if (!shawarma.visible) {
        shawarma.position.x = lanes[THREE.MathUtils.randInt(0, 2)];
        shawarma.position.z = OBSTACLE_SPAWN_Z - 50;
        shawarma.visible = true;
    }
}

function spawnSachetWater() {
    if (!sachetWater.visible) {
        sachetWater.position.x = lanes[THREE.MathUtils.randInt(0, 2)];
        sachetWater.position.z = OBSTACLE_SPAWN_Z - 100;
        sachetWater.visible = true;
    }
}

function spawnEnergyDrink() {
    if (!energyDrink.visible) {
        energyDrink.position.x = lanes[THREE.MathUtils.randInt(0, 2)];
        energyDrink.position.z = OBSTACLE_SPAWN_Z - 75;
        energyDrink.visible = true;
    }
}

function spawnSpeedBoost() {
    const boostType = Math.random();
    if (boostType < 0.7) { // 70% chance for 2x
        if (!speedBoost2x.visible) {
            speedBoost2x.position.x = lanes[THREE.MathUtils.randInt(0, 2)];
            speedBoost2x.position.z = OBSTACLE_SPAWN_Z - 120;
            speedBoost2x.visible = true;
        }
    } else { // 30% chance for 5x
        if (!speedBoost5x.visible) {
            speedBoost5x.position.x = lanes[THREE.MathUtils.randInt(0, 2)];
            speedBoost5x.position.z = OBSTACLE_SPAWN_Z - 120;
            speedBoost5x.visible = true;
        }
    }
}

// =========== OBSTACLE GENERATION ===========
const OBSTACLE_POOL_SIZE = 20;
const OBSTACLE_SPAWN_Z = -150;

function createDanfo() {
    const danfo = new THREE.Group();
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(3, 3, 8), // Reduced width from 4 to 3
        new THREE.MeshStandardMaterial({ color: 0xFFC300 })
    );
    body.position.y = 1.5;
    danfo.add(body);

    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const wheelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);

    const frontWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    frontWheel.rotation.z = Math.PI / 2;
    frontWheel.position.set(-1.5, 0.5, 2.5);
    danfo.add(frontWheel);

    const rearWheel = frontWheel.clone();
    rearWheel.position.z = -2.5;
    danfo.add(rearWheel);

    const rightFrontWheel = frontWheel.clone();
    rightFrontWheel.position.x = 1.5;
    danfo.add(rightFrontWheel);

    const rightRearWheel = rearWheel.clone();
    rightRearWheel.position.x = 1.5;
    danfo.add(rightRearWheel);

    danfo.userData.z_speed = 0;
    danfo.userData.type = 'danfo';

    return danfo;
}

function createTruck() {
    const truck = new THREE.Group();
    const chassis = new THREE.Mesh(
        new THREE.BoxGeometry(4, 4, 12),
        new THREE.MeshStandardMaterial({ color: 0xAAAAAA })
    );
    chassis.position.y = 3;
    truck.add(chassis);

    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const wheelGeometry = new THREE.CylinderGeometry(0.8, 0.8, 1, 32);

    const frontWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    frontWheel.rotation.z = Math.PI / 2;
    frontWheel.position.set(-2.5, 1, 4);
    truck.add(frontWheel);

    const rearWheel = frontWheel.clone();
    rearWheel.position.z = -4;
    truck.add(rearWheel);

    const rightFrontWheel = frontWheel.clone();
    rightFrontWheel.position.x = 2.5;
    truck.add(rightFrontWheel);

    const rightRearWheel = rearWheel.clone();
    rightRearWheel.position.x = 2.5;
    truck.add(rightRearWheel);

    truck.userData.z_speed = 0;
    truck.userData.type = 'truck';

    return truck;
}

const obstacles = [];
const trucks = [];

for (let i = 0; i < OBSTACLE_POOL_SIZE; i++) {
    const obstacle = createDanfo();
    obstacle.position.y = 1;
    obstacle.position.z = OBSTACLE_SPAWN_Z;
    obstacle.visible = false;
    scene.add(obstacle);
    obstacles.push(obstacle);
}

for (let i = 0; i < 10; i++) {
    const truck = createTruck();
    truck.position.y = 1;
    truck.position.z = OBSTACLE_SPAWN_Z;
    truck.visible = false;
    scene.add(truck);
    trucks.push(truck);
}

function spawnObstacle() {
    // Spawn a truck on level 2 and above
    if (playerState.level > 1 && Math.random() < 0.2) {
        const inactiveTrucks = trucks.filter(t => !t.visible);
        if (inactiveTrucks.length > 0) {
            const truck = inactiveTrucks[0];
            truck.position.x = lanes[THREE.MathUtils.randInt(0, 2)];
            truck.position.z = OBSTACLE_SPAWN_Z;
            truck.visible = true;
            return; // Spawn a truck and skip spawning other obstacles this round
        }
    }

    const inactiveObstacles = obstacles.filter(o => !o.visible);
    const obstacleCount = playerState.level === 1 ? 1 : 2;

    if (inactiveObstacles.length < obstacleCount) return;

    if (obstacleCount === 1) {
        const lane = THREE.MathUtils.randInt(0, 2);
        const obstacle = inactiveObstacles[0];
        obstacle.position.x = lanes[lane];
        obstacle.position.z = OBSTACLE_SPAWN_Z;
        obstacle.visible = true;
        obstacle.userData.z_speed = 0;
    } else {
        const lane1 = THREE.MathUtils.randInt(0, 2);
        let lane2 = THREE.MathUtils.randInt(0, 2);
        while (lane2 === lane1) {
            lane2 = THREE.MathUtils.randInt(0, 2);
        }

        const obstacle1 = inactiveObstacles[0];
        const obstacle2 = inactiveObstacles[1];

        obstacle1.position.x = lanes[lane1];
        obstacle1.position.z = OBSTACLE_SPAWN_Z;
        obstacle1.visible = true;
        obstacle1.userData.z_speed = 0;

        obstacle2.position.x = lanes[lane2];
        obstacle2.position.z = OBSTACLE_SPAWN_Z;
        obstacle2.visible = true;

        // Make one of the two obstacles a moving one sometimes, more often at higher levels
        if (Math.random() < playerState.level * 0.2) { 
            obstacle2.userData.z_speed = Math.random() * 0.1 - 0.05;
        } else {
            obstacle2.userData.z_speed = 0;
        }
    }
}

// Spawn initial items
function spawnInitialItems() {
    spawnObstacle();
    spawnShawarma();
    spawnSachetWater();
    spawnEnergyDrink();
}

function getHighScore() {
    return parseInt(localStorage.getItem('highScore') || '0');
}

function updateHighScore(score) {
    const highScore = getHighScore();
    if (score > highScore) {
        localStorage.setItem('highScore', score);
        highScoreElement.textContent = `High Score: ${score}`;
    }
}

// =========== GAME START/OVER & RESTART ===========
function startGame() {
    Tone.start();
    if (Tone.context.state !== 'running') {
        Tone.context.resume();
    }
    Tone.Transport.start();
    startScreen.style.display = 'none';
    highScoreElement.textContent = `High Score: ${getHighScore()}`;
    playerState.lastLevelUpTime = Date.now();
    roadNameElement.textContent = roadNames[playerState.currentRoadIndex];
    spawnInitialItems();
    animate();
}

function gameOver() {
    playerState.isAlive = false;
    playerState.isFalling = true;
    sfx.gameOver();
    Tone.Transport.stop();
}

function restartGame() {
    playerState.isAlive = true;
    playerState.isFalling = false;
    player.rotation.x = 0;
    playerState.score = 0;
    playerState.level = 1;
    playerState.lastLevelUpTime = Date.now();
    levelElement.textContent = `Level: 1`;
    playerState.currentRoadIndex = 0;
    roadNameElement.textContent = roadNames[playerState.currentRoadIndex];
    playerState.nextJunctionScore = 10000;
    playerState.atJunction = false;
    playerState.shieldCount = 0;
    playerState.scoreMultiplier = 1.0;
    playerState.currentLaneIndex = 1;
    player.position.x = 0;
    playerState.targetX = 0;

    scoreElement.textContent = 'Score: 0';
    shieldElement.textContent = 'Shawarma: 0';

    obstacles.forEach(o => o.visible = false);
    shawarma.visible = false;
    sachetWater.visible = false;
    energyDrink.visible = false;

    spawnInitialItems();

    gameOverScreen.style.display = 'none';
    Tone.Transport.start();
    animate();
}

// =========== COLLISION DETECTION ===========
const playerBox = new THREE.Box3();
const obstacleBox = new THREE.Box3();
const powerupBox = new THREE.Box3();

function startBlinking(duration) {
    playerState.isInvincible = true;
    const blinkInterval = setInterval(() => {
        player.visible = !player.visible;
    }, 100);

    setTimeout(() => {
        clearInterval(blinkInterval);
        player.visible = true;
        playerState.isInvincible = false;
    }, duration);
}

function showPowerupNotification(name) {
    powerupNotificationElement.textContent = name;
    powerupNotificationElement.style.opacity = 1;
    setTimeout(() => {
        powerupNotificationElement.style.opacity = 0;
    }, 1000);
}

function checkCollisions() {
    if (!playerState.isAlive) return;

    const playerBox = new THREE.Box3().setFromObject(player);
    const allObstacles = [...obstacles, ...trucks];

    // Obstacle Collision
    allObstacles.forEach(obstacle => {
        if (obstacle.visible) {
            const obstacleBox = new THREE.Box3().setFromObject(obstacle);
            if (playerBox.intersectsBox(obstacleBox)) {
                // If it's a truck and player is sliding, ignore collision
                if (obstacle.userData.type === 'truck' && playerState.isSliding) {
                    return; // Ignore collision
                }

                const isLanding = playerState.yVelocity < 0 && player.position.y > obstacle.position.y;

                if (isLanding) {
                    player.position.y = obstacle.position.y + 3.5; // Adjust based on model heights
                    playerState.isJumping = false;
                    playerState.isGliding = false;
                    playerState.yVelocity = 0;
                    playerState.isOnObstacle = obstacle; // Store reference to the obstacle
                } else if (playerState.isInvincible) {
                    obstacle.visible = false; // Just pass through
                } else if (playerState.shieldCount > 0) {
                    sfx.collision();
                    playerState.shieldCount--;
                    shieldElement.textContent = `Shawarma: ${playerState.shieldCount}`;
                    obstacle.visible = false; // Consume shield and ignore obstacle
                    startBlinking(1000); // 1 second of blinking invincibility
                } else {
                    gameOver();
                }
            }
        }
    });

    // Power-up Collision
    if (shawarma.visible) {
        powerupBox.setFromObject(shawarma);
        if (playerBox.intersectsBox(powerupBox)) {
            sfx.powerup();
            playerState.shieldCount++;
            shieldElement.textContent = `Shawarma: ${playerState.shieldCount}`;
            shawarma.visible = false;
            showPowerupNotification('Shawarma Shield!');
        }
    }

    if (sachetWater.visible) {
        powerupBox.setFromObject(sachetWater);
        if (playerBox.intersectsBox(powerupBox)) {
            sfx.powerup();
            sachetWater.visible = false;
            gameSpeed = BASE_SPEED * 2; // Speed burst
            startBlinking(INVINCIBILITY_DURATION);
            showPowerupNotification('Sachet Water!');

            setTimeout(() => {
                gameSpeed = BASE_SPEED;
            }, INVINCIBILITY_DURATION);
        }
    }

    if (energyDrink.visible) {
        powerupBox.setFromObject(energyDrink);
        if (playerBox.intersectsBox(powerupBox)) {
            sfx.powerup();
            energyDrink.visible = false;
            playerState.scoreMultiplier = 2.0;
            showPowerupNotification('Energy Drink! 2x Score!');

            setTimeout(() => {
                playerState.scoreMultiplier = 1.0;
            }, SCORE_MULTIPLIER_DURATION);
        }
    }

    if (speedBoost2x.visible) {
        powerupBox.setFromObject(speedBoost2x);
        if (playerBox.intersectsBox(powerupBox)) {
            sfx.powerup();
            speedBoost2x.visible = false;
            playerState.speedMultiplier = 2.0;
            showPowerupNotification('2x Speed Boost!');
            setTimeout(() => {
                playerState.speedMultiplier = 1.0;
            }, 10000);
        }
    }

    if (speedBoost5x.visible) {
        powerupBox.setFromObject(speedBoost5x);
        if (playerBox.intersectsBox(powerupBox)) {
            sfx.powerup();
            speedBoost5x.visible = false;
            playerState.speedMultiplier = 5.0;
            showPowerupNotification('5x Speed Boost!');
            setTimeout(() => {
                playerState.speedMultiplier = 1.0;
            }, 10000);
        }
    }
}

// =========== GAME LOOP ===========
function animate() {
    requestAnimationFrame(animate);

    if (playerState.isFalling) {
        if (player.rotation.x < Math.PI / 2) {
            player.rotation.x += 0.1;
            player.position.y -= 0.05;
        } else {
            playerState.isFalling = false;
            const finalScore = Math.floor(playerState.score);
            finalScoreElement.textContent = finalScore;
            updateHighScore(finalScore);
            gameOverScreen.style.display = 'block';
        }
        renderer.render(scene, camera);
        return;
    }

    if (!playerState.isAlive || playerState.isPaused) {
        return;
    }

    // Level Up Check
    const timeSinceLevelUp = Date.now() - playerState.lastLevelUpTime;
    if (timeSinceLevelUp > 120000) { // 2 minutes
        playerState.level++;
        levelElement.textContent = `Level: ${playerState.level}`;
        playerState.lastLevelUpTime = Date.now();
    }

    // Calculate speed
    const autoSpeed = BASE_SPEED + (playerState.level * 0.05);
    gameSpeed = autoSpeed * playerState.speedMultiplier;

    // Update Score
    playerState.score += playerState.scoreMultiplier;
    scoreElement.textContent = `Score: ${Math.floor(playerState.score)}`;

    // Animate Roads
    roads.forEach(road => {
        road.position.z += gameSpeed;
        if (road.position.z > ROAD_LENGTH / 2) {
            road.position.z -= ROAD_LENGTH * 2;
        }
    });

    // Animate Buildings
    allBuildings.forEach(building => {
        building.position.z += gameSpeed;
        if (building.position.z > camera.position.z) { // If building is behind camera
            building.position.z -= (BUILDING_DEPTH + BUILDING_SPACING) * BUILDING_POOL_SIZE;
            const height = THREE.MathUtils.randInt(BUILDING_MIN_HEIGHT, BUILDING_MAX_HEIGHT);
            building.scale.y = height;
            building.position.y = height / 2 - 0.5;
        }
    });

    // Animate Obstacles
    let shouldSpawnObstacle = true;
    const allObstacles = [...obstacles, ...trucks];
    allObstacles.forEach(obstacle => {
        if (obstacle.visible) {
            obstacle.position.z += gameSpeed + obstacle.userData.z_speed;
            if (obstacle.position.z > camera.position.z) {
                obstacle.visible = false;
            }
            // Increase spawn distance to reduce density
            if (obstacle.position.z > OBSTACLE_SPAWN_Z + 80) { 
                shouldSpawnObstacle = false;
            }
        }
    });

    if (shouldSpawnObstacle) {
        spawnObstacle();
    }

    // Animate Junctions
    if (playerState.score > playerState.nextJunctionScore && !playerState.atJunction) {
        spawnJunction();
    }

    junctions.forEach(junction => {
        if (junction.visible) {
            junction.position.z += gameSpeed;
            if (junction.position.z > camera.position.z) {
                junction.visible = false;
                playerState.atJunction = false; // Missed the junction
            }
        }
    });

    // Animate Power-ups
    if (shawarma.visible) {
        shawarma.position.z += gameSpeed;
        shawarma.rotation.y += 0.05;
        if (shawarma.position.z > camera.position.z) {
            shawarma.visible = false;
        }
    } else {
        if (Math.random() < 0.001) {
            spawnShawarma();
        }
    }

    if (sachetWater.visible) {
        sachetWater.position.z += gameSpeed;
        sachetWater.rotation.y += 0.05;
        if (sachetWater.position.z > camera.position.z) {
            sachetWater.visible = false;
        }
    } else {
        if (Math.random() < 0.002) { 
            spawnSachetWater();
        }
    }

    if (energyDrink.visible) {
        energyDrink.position.z += gameSpeed;
        energyDrink.rotation.y += 0.05;
        if (energyDrink.position.z > camera.position.z) {
            energyDrink.visible = false;
        }
    } else {
        if (Math.random() < 0.0015) {
            spawnEnergyDrink();
        }
    }

    if (playerState.score > playerState.nextSpeedBoostScore) {
        spawnSpeedBoost();
        playerState.nextSpeedBoostScore += 5000;
    }

    if (speedBoost2x.visible) {
        speedBoost2x.position.z += gameSpeed;
        speedBoost2x.rotation.y += 0.05;
        if (speedBoost2x.position.z > camera.position.z) {
            speedBoost2x.visible = false;
        }
    }

    if (speedBoost5x.visible) {
        speedBoost5x.position.z += gameSpeed;
        speedBoost5x.rotation.y += 0.05;
        if (speedBoost5x.position.z > camera.position.z) {
            speedBoost5x.visible = false;
        }
    }

    // Animate Player
    const lerpFactor = 0.1;
    player.position.x = THREE.MathUtils.lerp(player.position.x, playerState.targetX, lerpFactor);

    // Handle Sliding Animation
    if (playerState.isSliding) {
        player.scale.y = 0.5;
        player.children[1].rotation.x = Math.PI / 2;
    } else {
        player.scale.y = 1;
        player.children[1].rotation.x = 0;
    }

    // Handle running on obstacle
    if (playerState.isOnObstacle) {
        const obstacle = playerState.isOnObstacle;
        const obstacleHalfLength = obstacle.children[0].geometry.parameters.depth / 2;
        if (player.position.z > obstacle.position.z + obstacleHalfLength || player.position.z < obstacle.position.z - obstacleHalfLength) {
            playerState.isOnObstacle = false;
            playerState.isJumping = true; // Start falling
        }
    }

    // Handle Jump
    if (playerState.isJumping) {
        player.position.y += playerState.yVelocity;
        if (playerState.isGliding) {
            playerState.yVelocity += GRAVITY / 4; // Reduced gravity while gliding
        } else {
            playerState.yVelocity += GRAVITY;
        }

        // Leg tuck animation
        const tuck = 1 - (player.position.y - 0.5) / (JUMP_POWER / -GRAVITY);
        player.children[4].scale.y = 1 - tuck * 0.5;
        player.children[5].scale.y = 1 - tuck * 0.5;

        if (player.position.y <= 0.5) {
            player.position.y = 0.5;
            playerState.isJumping = false;
            playerState.isGliding = false;
            playerState.yVelocity = 0;
            player.children[4].scale.y = 1;
            player.children[5].scale.y = 1;
        }
    }

    // Animate player's run
    const runSpeed = 15; // Adjust for faster or slower running animation
    const runAmplitude = 0.5;
    player.children[2].rotation.x = Math.sin(Date.now() * 0.001 * runSpeed) * runAmplitude;
    player.children[3].rotation.x = Math.sin(Date.now() * 0.001 * runSpeed) * -runAmplitude;
    player.children[4].rotation.x = Math.sin(Date.now() * 0.001 * runSpeed) * -runAmplitude;
    player.children[5].rotation.x = Math.sin(Date.now() * 0.001 * runSpeed) * runAmplitude;

    // Check if switching is complete
    if (Math.abs(player.position.x - playerState.targetX) < 0.01) {
        player.position.x = playerState.targetX;
        playerState.isSwitching = false;
    }

    checkCollisions();

    renderer.render(scene, camera);
}

// =========== RESIZE HANDLER ===========
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// The game no longer starts automatically. It waits for the user to click the start button.
