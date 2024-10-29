-- drop table users
CREATE TABLE IF NOT EXISTS users
(
    id character varchar(240),
    emailed_token varchar(10),
    user_id varchar(240),
    CONSTRAINT pk_users PRIMARY KEY (id)
)

-- drop table members
create table members (
    id varchar(50),
    legacy_id varchar(20),
    name varchar(270),
    sex varchar(1),
    birth date,
    user_id varchar(240),
    CONSTRAINT pk_members PRIMARY KEY (id),
    CONSTRAINT fk_member_user FOREIGN KEY (user_id)
        REFERENCES users (id)
)




