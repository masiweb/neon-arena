import asyncio
import math
import time
import unittest
from server.game import Room, Player, WEAPON_SPECS, visible_footprints, RADAR_RANGE, clear_position
from server.maps import MAPS

class CombatTests(unittest.TestCase):
    def make(self):
        room=Room('TEST')
        room.phase='playing'
        a=Player('a','A','#fff',None,50,350)
        b=Player('b','B','#f00',None,180,350)
        room.players={'a':a,'b':b}
        return room,a,b

    def test_empty_ammo_cannot_fire_and_box_refills(self):
        r,a,b=self.make();a.ammo['base']=0
        r._fire(a,time.monotonic());self.assertEqual(len(r.bullets),0)
        r._apply_powerup(a,'ammo',time.monotonic())
        self.assertEqual(a.ammo['base'],45)
        r._fire(a,time.monotonic());self.assertEqual(a.ammo['base'],44)

    def test_two_slots_replaces_active_and_preserves_other_ammo(self):
        r,a,b=self.make();a.ammo['base']=12
        r._give_weapon(a,'sniper');r._give_weapon(a,'rapid')
        self.assertEqual(a.inventory,['base','rapid'])
        self.assertEqual(a.ammo['base'],12)
        self.assertNotIn('sniper',a.ammo)
        asyncio.run(r.handle(a,{'type':'action','action':'switch_weapon'}))
        self.assertEqual(a.weapon,'base')

    def test_zoom_only_sniper_and_cycles(self):
        r,a,b=self.make()
        asyncio.run(r.handle(a,{'type':'action','action':'zoom'}));self.assertEqual(a.zoom,1)
        r._give_weapon(a,'sniper')
        for expected in [2,4,8,1]:
            asyncio.run(r.handle(a,{'type':'action','action':'zoom'}));self.assertEqual(a.zoom,expected)

    def test_footprints_range_age_and_stance(self):
        r,a,b=self.make();now=time.monotonic();b.footprints=[(b.x,b.y,now)]
        self.assertTrue(visible_footprints(a,b,now))
        for stance in ['crouch','prone']:
            b.stance=stance;self.assertFalse(visible_footprints(a,b,now))
        b.stance='stand';self.assertFalse(visible_footprints(a,b,now+3))
        b.x=a.x+RADAR_RANGE+1;self.assertFalse(visible_footprints(a,b,now))

    def test_stationary_player_produces_no_footprints(self):
        r,a,b=self.make();now=time.monotonic()
        r._update_players(.016,now);self.assertEqual(a.footprints,[])
        a.move_y=1;r._update_players(.016,now+.3);self.assertTrue(a.footprints)
        asyncio.run(r.handle(a,{'type':'action','action':'prone'}));self.assertEqual(a.footprints,[])

    def test_bot_cannot_find_hidden_or_distant_target(self):
        r,a,b=self.make();a.is_bot=True;now=time.monotonic()
        r._update_bot_input(a,now);self.assertFalse(a.shooting)
        b.footprints=[(b.x,b.y,now)]
        r._update_bot_input(a,now);self.assertTrue(a.shooting)
        b.stance='prone';r._update_bot_input(a,now);self.assertFalse(a.shooting)

    def test_prone_speed_and_jump(self):
        r,a,b=self.make();a.stance='prone';a.move_y=1;now=time.monotonic()
        y=a.y;r._update_players(.05,now)
        self.assertAlmostEqual(a.y-y,285*.28*.05)
        asyncio.run(r.handle(a,{'type':'action','action':'jump'}));self.assertTrue(a.grounded)

    def test_lock_dwell_and_break(self):
        r,a,b=self.make();r._give_weapon(a,'rpg');now=time.monotonic()
        a.aim_pitch=math.atan2(72*.55-63,130)
        # Move farther so lock cone has a realistic vertical angle.
        a.y=b.y=100;b.x=450;a.aim_pitch=math.atan2(72*.55-63,400)
        r._update_lock(a,now);self.assertEqual(a.lock_target,b.id);self.assertFalse(a.lock_ready)
        r._update_lock(a,now+1.3);self.assertTrue(a.lock_ready)
        r._launch_rpg(a,now+1.4);self.assertEqual(r.projectiles[0].target_id,b.id)
        a.aim_x=-1;r._update_lock(a,now+1.5);self.assertFalse(a.lock_ready)

    def test_lock_never_targets_teammate(self):
        r,a,b=self.make();r._give_weapon(a,'rpg');a.team_id=b.team_id=1
        r._update_lock(a,time.monotonic());self.assertIsNone(a.lock_target)

    def test_rocket_consumes_ammo_and_does_not_fire_empty(self):
        r,a,b=self.make();r._give_weapon(a,'rpg');a.rockets=1;a.ammo['rpg']=1;now=time.monotonic()
        r._fire(a,now);self.assertEqual(a.ammo['rpg'],0)
        r._fire(a,now+2);self.assertEqual(len(r.projectiles),1)

    def test_all_map_faction_spawns_separated(self):
        for map_id in MAPS:
            r=Room('MAP');r.map_id=map_id
            r.players={str(i):Player(str(i),'P','#fff',None,0,0,team_id=i//3) for i in range(12)}
            placed=[]
            for p in r.players.values():
                p.x,p.y=r._faction_spawn(p,placed)
                self.assertTrue(clear_position(p.x,p.y,arena=r.arena))
                for q in placed:
                    if q.team_id!=p.team_id:self.assertGreater(math.hypot(p.x-q.x,p.y-q.y),800)
                placed.append(p)

    def test_no_district_replication(self):
        for arena in MAPS.values():
            self.assertEqual(arena['sectorWidth'],arena['width'])
            self.assertFalse(any('district' in w for w in arena['obstacles']))
            positions={(w['x'],w['y'],w['w'],w['h']) for w in arena['obstacles']}
            self.assertEqual(len(positions),len(arena['obstacles']))

    def test_snapshot_footprints_are_per_observer(self):
        class Socket:
            def __init__(self):self.messages=[]
            async def send_json(self,payload):self.messages.append(payload)
        r,a,b=self.make();a.socket=Socket();b.socket=Socket();now=time.monotonic()
        b.footprints=[(b.x,b.y,now)]
        asyncio.run(r.broadcast_state(now))
        self.assertEqual(len(a.socket.messages[-1]['footprints']),1)
        self.assertEqual(b.socket.messages[-1]['footprints'],[])

if __name__=='__main__':unittest.main()
