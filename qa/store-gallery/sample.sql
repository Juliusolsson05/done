BEGIN;
INSERT INTO project(id,name,color) VALUES
 (130,'Studio open house',2),(140,'Field notes',5),(150,'Personal',3);
INSERT INTO task(id,title,project_id,priority,status,due,goal_day) VALUES
 (31,'Send the open house invitations',130,1,'doing',date('now','localtime'),date('now','localtime')),
 (32,'Pick six prints for the front wall',130,2,'doing',date('now','localtime'),NULL),
 (33,'Edit the interview with Rowan',140,2,'doing',date('now','localtime'),NULL),
 (34,'Proof the printed programmes',130,3,NULL,date('now','localtime'),NULL),
 (35,'Return the library books',150,4,NULL,date('now','localtime'),NULL),
 (36,'Order coffee for Saturday',130,3,NULL,date('now','localtime'),NULL),
 (37,'Scan the contact sheets',140,4,NULL,date('now','localtime'),NULL),
 (38,'Choose a cover photograph',140,2,NULL,date('now','localtime','+1 day'),NULL),
 (39,'Walk the room with Ari',130,3,NULL,date('now','localtime','+1 day'),NULL),
 (40,'Collect the folding chairs',130,3,NULL,date('now','localtime','+2 days'),NULL),
 (41,'Pack for the train',150,4,NULL,date('now','localtime','+2 days'),NULL),
 (42,'Send the issue to print',140,1,NULL,date('now','localtime','+3 days'),NULL),
 (43,'Hang the window sign',130,3,NULL,date('now','localtime','+3 days'),NULL),
 (44,'Post the studio recap',140,4,NULL,date('now','localtime','+5 days'),NULL);
INSERT INTO task(id,title,project_id,priority,done_day) VALUES
 (45,'Book the print room',130,4,date('now','localtime')),
 (46,'Test the projector',130,4,date('now','localtime','-1 day'));
INSERT INTO note(id,text,updated_at) VALUES
 (150,'Open house run of show

Saturday · Alder Street studio

## Before doors open
Ari sets the prints along the front wall. Rowan brings coffee and the guest book.

## On the day
10:00  Set the tables by the windows
11:00  Open the doors and put on music
12:30  Walk through the new prints

## Before Friday
[Send the open house invitations](done:task/31)

Keep a few programmes by the door for late arrivals.',strftime('%s','now')*1000),
 (151,'Interview selects

Three moments to keep from our conversation with Rowan.

- The first roll of film
- Working through the winter
- Finding the last frame',strftime('%s','now')*1000-60000),
 (152,'Print wall measurements

Left wall 240 cm. Leave space between the two largest prints.',strftime('%s','now')*1000-120000),
 (153,'Coffee order

One flask of filter, one decaf. Bring the enamel cups.',strftime('%s','now')*1000-180000);
COMMIT;
