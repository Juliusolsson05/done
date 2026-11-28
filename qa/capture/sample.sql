BEGIN;
INSERT INTO project(id,name,color) VALUES(130,'Spring gathering',2),(140,'Weekend plans',5);
INSERT INTO task(id,title,project_id,due,priority,goal_day) VALUES
(31,'Sketch the invitation',130,date('now','localtime'),1,date('now','localtime')),
(32,'Choose plants for the terrace',130,date('now','localtime'),2,NULL),
(33,'Review the weekend route',140,date('now','localtime'),3,NULL),
(34,'Book a pottery class',140,date('now','localtime','+1 day'),2,NULL),
(35,'Share the reading list',130,date('now','localtime','+3 days'),3,NULL),
(36,'Find a gift for the host',130,date('now','localtime','+4 days'),2,NULL);
INSERT INTO note(id,text,updated_at) VALUES(150,'Garden gathering

## Before the weekend
1. Choose a spot in the garden
   1. Check the afternoon light
   2. Measure the table
2. Decide what to bring

## Next step
[Sketch the invitation](done:task/31)',strftime('%s','now')*1000);
COMMIT;
