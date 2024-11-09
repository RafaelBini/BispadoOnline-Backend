-- drop table users
CREATE TABLE IF NOT EXISTS users
(
    id serial primary key,
	email varchar(240),
    emailed_token varchar(10),
    user_id varchar(240)
)

--insert into users values (default, 'rfabini1996@gmail.com', '', '')

-- drop table members
create table members (
    id varchar(50) primary key,
    legacy_id varchar(20),
    name varchar(270),
    sex varchar(1),
    birth date,
    user_id int,
    CONSTRAINT fk_member_user FOREIGN KEY (user_id) REFERENCES users (id)
)

-- drop table sacramentals
create table sacramentals (
	id int primary key,
	date date,
	sunday_of_the_month int,
	user_id varchar(1)
)

-- drop table speeches
create table speeches (
	id serial primary key,
	member_id varchar(50),
	sacramental_id int,
	minutes int,
	topic varchar(200),
	reference varchar(500),
	message_copied boolean,
	is_wild_card boolean,
	wild_text varchar(120),
	user_id int,
	CONSTRAINT fk_speeches_member FOREIGN KEY (member_id) REFERENCES members (id),
	CONSTRAINT fk_speeches_sacramental FOREIGN KEY (sacramental_id) REFERENCES sacramentals (id)
)

-- drop table invite_template
create table invite_template (
	id serial primary key,
	invite_template varchar(900),
	user_id int
)

-- drop view speeches_view;
create view speeches_view as
select 
s.id as sacramental_id, 
s.date as sacramental_date,
s.sunday_of_the_month,
p.id as speech_id,
message_copied,
member_id,
m.name as member_name,
p.is_wild_card,
p.wild_text,
topic,
reference,
minutes,
p.user_id as speech_user_id,
s.user_id
from sacramentals s
left join speeches p on (s.id = p.sacramental_id)
left join members m on (m.id = p.member_id)


-- drop view detailed_members_view;
create view detailed_members_view as 
select 
m.id,
m.name,
DATE_PART('year', age(now(), m.birth)) as age,
(select max(minutes) from speeches p where member_id = m.id and p.user_id=m.user_id) minutes,
(select count(id) from speeches s where member_id = m.id and s.user_id=m.user_id) speeches_count,
(select max(s.date) from speeches p inner join sacramentals s on s.id = p.sacramental_id where member_id = m.id and p.user_id=m.user_id) last_speech,
m.user_id
from members m

