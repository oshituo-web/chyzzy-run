import * as THREE from 'three';

// =========== SCENE SETUP ===========
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87CEEB, 1, 200);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas') });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// =========== LIGHTING ===========
const hemisphereLight = new THREE.HemisphereLight(0xFFFFBB, 0x080820, 1);
scene.add(hemisphereLight);
const directionalLight = new THREE.DirectionalLight(0xFFFFFF, 0.8);
directionalLight.position.set(0, 10, 5);
scene.add(directionalLight);

// =========== ROAD ===========
const roadGeometry = new THREE.PlaneGeometry(30, 200);
const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
const road = new THREE.Mesh(roadGeometry, roadMaterial);
road.rotation.x = -Math.PI / 2;
road.position.y = -0.5;
scene.add(road);

// =========== PLAYER ===========
function createPlayer() {
    const player = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), new THREE.MeshStandardMaterial({ color: 0xE0AC69 }));
    head.position.y = 2.5;
    player.add(head);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 0.5), new THREE.MeshStandardMaterial({ color: 0xFF0000 }));
    torso.position.y = 1.25;
    player.add(torso);
    const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.1, 1.2, 32), new THREE.MeshStandardMaterial({ color: 0xE0AC69 }));
    leftArm.position.set(-0.7, 1.8, 0);
    player.add(leftArm);
    const rightArm = leftArm.clone();
    rightArm.position.x = 0.7;
    player.add(rightArm);
    const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 1.5, 32), new THREE.MeshStandardMaterial({ color: 0x0000FF }));
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

// =========== UI & GAME START ===========
const startScreen = document.getElementById('start-screen');
const startButton = document.getElementById('start-button');

function startGame() {
    startScreen.style.display = 'none';
    animate();
}
startButton.addEventListener('click', startGame);

// =========== GAME LOOP ===========
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

// =========== RESIZE HANDLER ===========
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});