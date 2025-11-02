import * as THREE from 'three';
import * as Tone from 'tone';

// =========== CONSTANTS ===========
const BASE_SPEED = 0.15;
const ROAD_LENGTH = 200;
const INVINCIBILITY_DURATION = 3000; // 3 seconds
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
    isAlive: true,
};

const scoreElement = document.getElementById('score');
const shieldElement = document.getElementById('shield-count');
const startScreen = document.getElementById('start-screen');
const startButton = document.getElementById('start-button');
const gameOverScreen = document.getElementById('game-over-screen');
const finalScoreElement = document.getElementById('final-score');
const restartButton = document.getElementById('restart-button');

function handleKeyPress(event) {
    if (playerState.isSwitching || !playerState.isAlive) return;

    let targetLaneIndex = playerState.currentLaneIndex;
    if (event.key === 'a' || event.key === 'ArrowLeft') {
        targetLaneIndex = Math.max(0, playerState.currentLaneIndex - 1);
    } else if (event.key === 'd' || event.key === 'ArrowRight') {
        targetLaneIndex = Math.min(2, playerState.currentLaneIndex + 1);
    }

    if (targetLaneIndex !== playerState.currentLaneIndex) {
        sfx.switch();
        playerState.currentLaneIndex = targetLaneIndex;
        playerState.targetX = lanes[targetLaneIndex];
        playerState.isSwitching = true;
    }
}

document.addEventListener('keydown', handleKeyPress);
startButton.addEventListener('click', startGame);
restartButton.addEventListener('click', restartGame);

// =========== BUILDING GENERATION ===========
const BUILDING_POOL_SIZE = 30;
const BUILDING_WIDTH = 15;
const BUILDING_DEPTH = 15;
const BUILDING_MIN_HEIGHT = 10;
const BUILDING_MAX_HEIGHT = 50;
const BUILDING_SPACING = 5;

const buildingColors = [0xFFC300, 0xFF5733, 0xC70039, 0x900C3F, 0x581845];
const buildingGeometry = new THREE.BoxGeometry(BUILDING_WIDTH, 1, BUILDING_DEPTH);

function createBuilding(side, z) {
    const height = THREE.MathUtils.randInt(BUILDING_MIN_HEIGHT, BUILDING_MAX_HEIGHT);
    const color = buildingColors[THREE.MathUtils.randInt(0, buildingColors.length - 1)];
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

// =========== OBSTACLE GENERATION ===========
const OBSTACLE_POOL_SIZE = 20;
const OBSTACLE_SPAWN_Z = -150;

function createDanfo() {
    const danfo = new THREE.Group();
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(4, 3, 8),
        new THREE.MeshStandardMaterial({ color: 0xFFC300 })
    );
    body.position.y = 1.5;
    danfo.add(body);

    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const wheelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);

    const frontWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    frontWheel.rotation.z = Math.PI / 2;
    frontWheel.position.set(-2, 0.5, 2.5);
    danfo.add(frontWheel);

    const rearWheel = frontWheel.clone();
    rearWheel.position.z = -2.5;
    danfo.add(rearWheel);

    const rightFrontWheel = frontWheel.clone();
    rightFrontWheel.position.x = 2;
    danfo.add(rightFrontWheel);

    const rightRearWheel = rearWheel.clone();
    rightRearWheel.position.x = 2;
    danfo.add(rightRearWheel);

    return danfo;
}

const obstacles = [];

for (let i = 0; i < OBSTACLE_POOL_SIZE; i++) {
    const obstacle = createDanfo();
    obstacle.position.y = 1;
    obstacle.position.z = OBSTACLE_SPAWN_Z;
    obstacle.visible = false;
    scene.add(obstacle);
    obstacles.push(obstacle);
}

function spawnObstacle() {
    const obstacle = obstacles.find(o => !o.visible);
    if (obstacle) {
        obstacle.position.x = lanes[THREE.MathUtils.randInt(0, 2)];
        obstacle.position.z = OBSTACLE_SPAWN_Z;
        obstacle.visible = true;
    }
}

// Spawn initial items
function spawnInitialItems() {
    spawnObstacle();
    spawnShawarma();
    spawnSachetWater();
    spawnEnergyDrink();
}

// =========== GAME START/OVER & RESTART ===========
function startGame() {
    Tone.start();
    Tone.Transport.start();
    startScreen.style.display = 'none';
    spawnInitialItems();
    animate();
}

function gameOver() {
    playerState.isAlive = false;
    sfx.gameOver();
    Tone.Transport.stop();
    finalScoreElement.textContent = Math.floor(playerState.score);
    gameOverScreen.style.display = 'block';
}

function restartGame() {
    playerState.isAlive = true;
    playerState.score = 0;
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

function checkCollisions() {
    if (!playerState.isAlive) return;

    playerBox.setFromObject(player);

    // Obstacle Collision
    obstacles.forEach(obstacle => {
        if (obstacle.visible) {
            obstacleBox.setFromObject(obstacle);
            if (playerBox.intersectsBox(obstacleBox)) {
                if (playerState.isInvincible) {
                    obstacle.visible = false; // Just pass through
                } else if (playerState.shieldCount > 0) {
                    sfx.collision();
                    playerState.shieldCount--;
                    shieldElement.textContent = `Shawarma: ${playerState.shieldCount}`;
                    obstacle.visible = false; // Consume shield and ignore obstacle
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
        }
    }

    if (sachetWater.visible) {
        powerupBox.setFromObject(sachetWater);
        if (playerBox.intersectsBox(powerupBox)) {
            sfx.powerup();
            sachetWater.visible = false;
            playerState.isInvincible = true;
            gameSpeed = BASE_SPEED * 2; // Speed burst
            playerMaterial.color.set(0x0000FF); // Indicate invincibility

            setTimeout(() => {
                playerState.isInvincible = false;
                gameSpeed = BASE_SPEED;
                playerMaterial.color.set(0xFF0000); // Back to normal
            }, INVINCIBILITY_DURATION);
        }
    }

    if (energyDrink.visible) {
        powerupBox.setFromObject(energyDrink);
        if (playerBox.intersectsBox(powerupBox)) {
            sfx.powerup();
            energyDrink.visible = false;
            playerState.scoreMultiplier = 2.0;

            setTimeout(() => {
                playerState.scoreMultiplier = 1.0;
            }, SCORE_MULTIPLIER_DURATION);
        }
    }
}

// =========== GAME LOOP ===========
function animate() {
    if (!playerState.isAlive) {
        return;
    }

    requestAnimationFrame(animate);

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
    obstacles.forEach(obstacle => {
        if (obstacle.visible) {
            obstacle.position.z += gameSpeed;
            if (obstacle.position.z > camera.position.z) {
                obstacle.visible = false;
            }
            if (obstacle.position.z > OBSTACLE_SPAWN_Z + 20) {
                shouldSpawnObstacle = false;
            }
        }
    });

    if (shouldSpawnObstacle) {
        spawnObstacle();
    }

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

    // Animate Player
    const lerpFactor = 0.1;
    player.position.x = THREE.MathUtils.lerp(player.position.x, playerState.targetX, lerpFactor);

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
